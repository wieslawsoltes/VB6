"""Strict, provenance-pinned TUI reference PNG comparison.

No reference generation, golden updates, scaling, masks or tolerance. References
are supplied by their authorized owner. Equality certifies only the listed image
pairs, not the authenticity of declared provenance or whole-product parity.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

MAX_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 16_777_216
ID = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\Z')
SHA = re.compile(r'[0-9a-f]{64}\Z')


def integer(value: Any, name: str, limit: int) -> int:
    if type(value) is not int or not 1 <= value <= limit:
        raise ValueError(f'{name} must be an integer in [1, {limit}]')
    return value


def text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 4096:
        raise ValueError(f'{name} requires nonempty bounded text')
    return value


def local_file(root: Path, name: str) -> Path:
    text(name, 'path')
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or '\x00' in name:
        raise ValueError('Reference paths must remain within their manifest directory')
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError('Reference path escapes its root')
    return resolved


def read_bounded(path: Path, maximum: int = MAX_BYTES) -> bytes:
    with path.open('rb') as stream:
        data = stream.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError(f'Input exceeds byte budget: {path.name}')
    return data


def manifest_cases(manifest: Any) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict) or type(manifest.get('version')) is not int or manifest['version'] != 1:
        raise ValueError('Unsupported reference manifest version')
    fixtures = manifest.get('fixtures')
    if not isinstance(fixtures, list) or not 1 <= len(fixtures) <= 256:
        raise ValueError('Reference manifest requires 1..256 fixtures; an empty suite is not acceptance')
    seen = set()
    for item in fixtures:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not ID.fullmatch(item['id']):
            raise ValueError('Invalid fixture id')
        if item['id'] in seen:
            raise ValueError('Duplicate fixture id')
        seen.add(item['id'])
        text(item.get('state'), 'state')
        for key in ['provenance', 'reference', 'cell']:
            if not isinstance(item.get(key), dict):
                raise ValueError(key + ' requires an object')
        for key in ['product', 'version', 'platform', 'method', 'source']:
            text(item.get('provenance', {}).get(key), 'provenance.' + key)
        reference = item.get('reference', {})
        text(reference.get('path'), 'reference.path')
        if not isinstance(reference.get('sha256'), str) or not SHA.fullmatch(reference['sha256']):
            raise ValueError('Reference requires a pinned SHA-256 digest')
        width = integer(reference.get('width'), 'reference.width', 16384)
        height = integer(reference.get('height'), 'reference.height', 16384)
        if width * height > MAX_PIXELS:
            raise ValueError('Reference exceeds pixel budget')
        cell = item.get('cell', {})
        integer(cell.get('width'), 'cell.width', 256)
        integer(cell.get('height'), 'cell.height', 512)
        if any(key in item for key in ['tolerance', 'mask', 'ignore', 'scale', 'threshold']):
            raise ValueError('Exact acceptance does not permit masks, scaling or tolerance')
    return fixtures


def decode_png(data: bytes):
    # Pillow is already pinned by the authoring CI requirements. Import lazily
    # so manifest/security validation remains usable with the Python standard library.
    from io import BytesIO
    from PIL import Image
    with Image.open(BytesIO(data)) as source:
        if source.format != 'PNG' or getattr(source, 'n_frames', 1) != 1:
            raise ValueError('A static PNG is required')
        if source.width * source.height > MAX_PIXELS:
            raise ValueError('Image exceeds pixel budget')
        source.load()
        return source.convert('RGBA')


def compare_png(reference: bytes, candidate: bytes, cell: dict[str, int], diff_path: Path) -> dict[str, Any]:
    from PIL import ImageChops
    cw, ch = integer(cell.get('width'), 'cell.width', 256), integer(cell.get('height'), 'cell.height', 512)
    expected, actual = decode_png(reference), decode_png(candidate)
    if expected.size != actual.size:
        return {'equal': False, 'reason': 'dimensions', 'expected': list(expected.size), 'actual': list(actual.size)}
    difference = ImageChops.difference(expected, actual)
    # RGBA.getbbox() alone can miss RGB changes when alpha differences are zero.
    # Compare all four channels explicitly, including fully transparent RGB data.
    red, green, blue, alpha = difference.split()
    maximum = ImageChops.lighter(ImageChops.lighter(red, green), ImageChops.lighter(blue, alpha))
    mask = maximum.point(lambda value: 255 if value else 0)
    changed = mask.histogram()[255]
    result: dict[str, Any] = {'equal': changed == 0, 'changedPixels': changed, 'totalPixels': expected.width * expected.height,
                              'bounds': mask.getbbox(), 'changedCells': 0, 'firstCells': []}
    if changed:
        # Stream a cell-height band instead of creating one Pillow object per
        # cell. Memory is bounded by one scan band and one byte per cell column.
        for top in range(0, expected.height, ch):
            band = mask.crop((0, top, expected.width, min(expected.height, top + ch))).tobytes()
            columns = bytearray((expected.width + cw - 1) // cw)
            for offset, value in enumerate(band):
                if value:
                    columns[(offset % expected.width) // cw] = 1
            for column, value in enumerate(columns):
                if value:
                    result['changedCells'] += 1
                    if len(result['firstCells']) < 200:
                        result['firstCells'].append([column, top // ch])
        mask.save(diff_path, format='PNG')
        result['differenceMask'] = diff_path.name
    return result


def run(manifest_path: Path, actual_root: Path, output: Path, revision: str) -> dict[str, Any]:
    text(revision, 'candidate revision')
    manifest_data = read_bounded(manifest_path, 1024 * 1024)
    fixtures = manifest_cases(json.loads(manifest_data))
    reference_root, actual_root, output = manifest_path.parent.resolve(), actual_root.resolve(), output.resolve()
    # Output must never overwrite the reference/candidate evidence roots.
    for root in [reference_root, actual_root]:
        if output == root or root.is_relative_to(output):
            raise ValueError('Output directory must not contain an input root')
    protected = {manifest_path.resolve()}
    for item in fixtures:
        protected.add(local_file(reference_root, item['reference']['path']))
        protected.add(local_file(actual_root, item['id'] + '.png'))
    targets = {(output / name).resolve() for name in ['results.json'] + [item['id'] + '-diff.png' for item in fixtures]}
    if any(not target.is_relative_to(output) for target in targets):
        raise ValueError('Output symlink escapes report directory')
    if protected & targets or any(target.exists() and source.exists() and target.samefile(source) for target in targets for source in protected):
        raise ValueError('Output would overwrite evidence')
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for item in fixtures:
        result = {'id': item['id'], 'state': item['state'], 'provenance': item['provenance'], 'equal': False}
        try:
            reference = read_bounded(local_file(reference_root, item['reference']['path']))
            actual = read_bounded(local_file(actual_root, item['id'] + '.png'))
            digest = hashlib.sha256(reference).hexdigest()
            if digest != item['reference']['sha256']:
                raise ValueError('Reference digest mismatch; expected image is not updated automatically')
            image = decode_png(reference)
            if image.size != (item['reference']['width'], item['reference']['height']):
                raise ValueError('Reference dimensions disagree with manifest')
            result.update(compare_png(reference, actual, item['cell'], output / (item['id'] + '-diff.png')))
            result.update(referenceSHA256=digest, candidateSHA256=hashlib.sha256(actual).hexdigest())
        except (OSError, ValueError) as error:
            result.update(reason='invalid-or-missing-evidence', error=str(error))
        results.append(result)
    report = {'format': 'vb6-tui-reference-result', 'version': 1, 'candidateRevision': revision,
              'manifestSHA256': hashlib.sha256(manifest_data).hexdigest(), 'exact': True,
              'passed': all(item['equal'] for item in results), 'fixtures': results,
              'scope': 'Only these pinned image pairs. Capture provenance requires independent review; no whole-product certification.'}
    (output / 'results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--actual', type=Path, required=True, help='Directory containing <fixture-id>.png files')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--revision', required=True, help='Exact candidate source revision')
    args = parser.parse_args()
    try:
        report = run(args.manifest, args.actual, args.output, args.revision)
        print(json.dumps({'passed': report['passed'], 'fixtures': len(report['fixtures'])}))
        return 0 if report['passed'] else 1
    except (OSError, ValueError, TypeError) as error:
        parser.exit(2, f'Reference acceptance failed: {error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
