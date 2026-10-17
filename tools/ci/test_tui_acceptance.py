"""Standard-library validation of TUI evidence admission and GPU harness imports."""
from __future__ import annotations
import ast
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from tui_reference import local_file, manifest_cases, read_bounded, run


def manifest():
    return {'version': 1, 'fixtures': [{'id': 'fixture', 'state': 'synthetic validation only',
        'provenance': {'product': 'synthetic', 'version': '1', 'platform': 'unit test',
                       'method': 'authored test data', 'source': 'not a vendor capture'},
        'reference': {'path': 'reference.png', 'sha256': '0' * 64, 'width': 8, 'height': 16},
        'cell': {'width': 8, 'height': 16}}]}


class EvidenceAdmission(unittest.TestCase):
    def test_nonempty_unique_bounded_suite(self):
        self.assertEqual(len(manifest_cases(manifest())), 1)
        for value in [None, {}, {'version': True, 'fixtures': []}, {'version': 1, 'fixtures': []}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                manifest_cases(value)
        value = manifest(); value['fixtures'] *= 2
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            manifest_cases(value)

    def test_schema_errors_are_explicit_before_decoding_images(self):
        for key in ['reference', 'provenance', 'cell']:
            for malformed in [None, [], 'text', 17]:
                value = manifest(); value['fixtures'][0][key] = malformed
                with self.subTest(key=key, value=malformed), self.assertRaises(ValueError):
                    manifest_cases(value)
        for invalid in [1, '../escape', '', 'a/b', 'x' * 81]:
            value = manifest(); value['fixtures'][0]['id'] = invalid
            with self.subTest(id=invalid), self.assertRaises(ValueError):
                manifest_cases(value)

    def test_exact_comparison_cannot_enable_tolerances_or_masks(self):
        for key in ['tolerance', 'mask', 'ignore', 'scale', 'threshold']:
            value = manifest(); value['fixtures'][0][key] = 0
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'Exact'):
                manifest_cases(value)

    def test_dimensions_provenance_and_digest_are_required(self):
        for edit in [lambda f: f['reference'].update(width=True),
                     lambda f: f['reference'].update(height=16385),
                     lambda f: f['reference'].update(width=16384, height=16384),
                     lambda f: f['cell'].update(width=0),
                     lambda f: f['reference'].update(sha256='not a hash'),
                     lambda f: f['provenance'].update(method='')]:
            value = manifest(); edit(value['fixtures'][0])
            with self.assertRaises(ValueError):
                manifest_cases(value)

    def test_confined_input_paths_and_byte_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'input'; root.mkdir()
            for name in ['../escape', '/absolute', r'a\b', '\0']:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    local_file(root, name)
            (root / 'out').symlink_to(Path(tmp))
            with self.assertRaises(ValueError):
                local_file(root, 'out/secret')
            data = root / 'bytes'; data.write_bytes(b'1234')
            self.assertEqual(read_bounded(data, 4), b'1234')
            with self.assertRaises(ValueError):
                read_bounded(data, 3)

    def test_missing_capture_is_a_failed_report_not_a_skip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); candidate = root / 'candidate'; candidate.mkdir()
            reference = root / 'reference'; reference.mkdir()
            path = reference / 'manifest.json'; path.write_text(json.dumps(manifest()))
            result = run(path, candidate, root / 'report', 'test-revision')
            self.assertFalse(result['passed'])
            self.assertEqual(result['fixtures'][0]['reason'], 'invalid-or-missing-evidence')
            self.assertTrue((root / 'report/results.json').is_file())

    def test_output_cannot_overwrite_evidence_via_symlinks_or_hardlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); actual = root / 'actual'; actual.mkdir()
            report = root / 'report'; report.mkdir()
            reference = root / 'reference'; reference.mkdir()
            path = reference / 'manifest.json'; path.write_text(json.dumps(manifest()))
            original = path.read_bytes(); target = report / 'results.json'
            target.symlink_to(path)
            with self.assertRaises(ValueError):
                run(path, actual, report, 'revision')
            self.assertEqual(path.read_bytes(), original)
            target.unlink(); target.hardlink_to(path)
            with self.assertRaises(ValueError):
                run(path, actual, report, 'revision')
            self.assertEqual(path.read_bytes(), original)

    def test_manifest_is_not_modified_by_admission(self):
        value = manifest(); before = copy.deepcopy(value)
        manifest_cases(value)
        self.assertEqual(value, before)


class RenderingEntrypoints(unittest.TestCase):
    def test_shared_launch_profile_is_explicitly_imported_where_called(self):
        checked = []
        for path in sorted(TOOLS.glob('browser-rendering*.py')):
            tree = ast.parse(path.read_text(encoding='utf-8'))
            called = any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and
                         n.func.id == 'rendering_launch_flags' for n in ast.walk(tree))
            if called:
                imported = any(isinstance(n, ast.ImportFrom) and n.module == 'rendering_launch' and
                               any(a.name == 'rendering_launch_flags' and a.asname in [None, a.name]
                                   for a in n.names) for n in tree.body)
                self.assertTrue(imported, path.name + ': undefined rendering_launch_flags')
                checked.append(path.name)
        self.assertIn('browser-rendering-tests.py', checked)


if __name__ == '__main__':
    unittest.main()
