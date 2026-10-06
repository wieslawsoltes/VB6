#!/usr/bin/env python3
"""Exercise real ZIP writers with an isolated, explicitly synthetic release.
No production validation report is synthesized or modified by this regression.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

TOOLS = Path(__file__).resolve().parent

class ArchivesComplete(Exception):
    pass

class PackageNotices(unittest.TestCase):
    def test_all_distributions_retain_nested_notices(self):
        script = 'package-release.py'
        with tempfile.TemporaryDirectory() as temp:
            spec = importlib.util.spec_from_file_location('packaging_under_test', TOOLS / script)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            root = Path(temp) / 'source'
            out = Path(temp) / 'out'
            module.ROOT = root
            notice = (TOOLS.parent / 'LICENSES/98.css.txt').read_bytes()
            fixtures = {
                'package.json': json.dumps({'version': '0.6.0'}).encode(),
                'LICENSES/98.css.txt': notice,
                'LICENSES/nested/example.txt': b'Test-only nested notice\n',
                'packages/example/README.md': b'Package porting contract\n',
                'packages/example/src/index.js': b'export const example = true;\n',
                'reports/release-validation.json': json.dumps({'version': '0.6.0', 'passed': True}).encode(),
            }
            fixtures['reports/README.md'] = b'# Durable porting index\n'
            fixtures['reports/private-run/temporary.log'] = b'Generated output\n'
            for name in getattr(module, 'REQUIRED_REPORTS', ()):
                fixtures.setdefault(name, b'Synthetic packaging-only evidence\n')
            for name in ['LICENSE', 'THIRD-PARTY-NOTICES.md',
                         'dist/VB6-Studio-Web.html', 'dist/vb6-runtime.js', 'dist/vb6-controls.css',
                         'dist/examples/richtext.html', 'dist/examples/mdi.html',
                         'src/runtime/entry.js', 'src/theme/bevels.css',
                         'docs/ARCHITECTURE.md', 'docs/COMPATIBILITY.md', 'docs/TESTING.md', 'docs/VISUAL-AUDIT.md',
                         'examples/example.vb6web']:
                fixtures.setdefault(name, b'Test fixture\n')
            for name, data in fixtures.items():
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
            archives = []
            write_archive = module.archive
            def record_archive(path, entries):
                write_archive(path, entries)
                archives.append(path)
                if len(archives) == 4:
                    # Stop before copying unrelated standalone reports/previews.
                    raise ArchivesComplete()
            with patch.object(module, 'archive', record_archive), patch.object(sys, 'argv', [script, '--out', str(out)]):
                with self.assertRaises(ArchivesComplete):
                    module.main()
            self.assertEqual(len(archives), 4)
            for archive in archives:
                with zipfile.ZipFile(archive) as z:
                    for suffix in ('LICENSES/98.css.txt', 'LICENSES/nested/example.txt'):
                        names = [name for name in z.namelist() if name.endswith(suffix)]
                        self.assertEqual(len(names), 1, (script, archive.name, suffix))
                        self.assertEqual(z.read(names[0]), fixtures[suffix])
                    manifests = [name for name in z.namelist() if name.endswith('SOURCE-SHA256SUMS.txt')]
                    if archive.name.endswith('-Source.zip'):
                        self.assertEqual(len(manifests), 1)
                        report_names = [name.split('/', 1)[1] for name in z.namelist() if '/reports/' in name]
                        self.assertEqual(report_names, ['reports/README.md'])
                        prefix = manifests[0].removesuffix('SOURCE-SHA256SUMS.txt')
                        for package_path in ('packages/example/README.md', 'packages/example/src/index.js'):
                            self.assertEqual(z.read(prefix + package_path), fixtures[package_path])
                        manifest = manifests[0]
                        entries = {}
                        for line in z.read(manifest).decode().splitlines():
                            checksum, name = line.split('  ', 1)
                            self.assertNotIn(name, entries)
                            entries[name] = checksum
                            self.assertEqual(checksum, hashlib.sha256(z.read(prefix + name)).hexdigest())
                        self.assertEqual({prefix + name for name in entries}, set(z.namelist()) - {manifest})
                        self.assertIn('LICENSES/98.css.txt', entries)
                    self.assertIsNone(z.testzip())

    def test_source_inventory_retains_build_inputs_not_local_dependencies(self):
        spec = importlib.util.spec_from_file_location('packaging_under_test', TOOLS / 'package-release.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'source'
            module.ROOT = root
            required = {
                '.gitattributes', '.github/workflows/validate.yml', 'package.json',
                'desktop/policy.cjs', 'desktop/package.json',
                'packages/auto-layout/src/index.js', 'packages/auto-layout/dist/auto-layout.js',
                'packages/win32-browser/src/index.js', 'packages/native-debugger/src/index.js',
                'packages/vb6-compute/cli-core.mjs', 'tools/build.mjs',
                'tests/tooling-references.test.mjs',
            }
            excluded = {
                'desktop/node_modules/dependency/index.js', 'packages/auto-layout/node_modules/dependency/index.js',
                'tools/__pycache__/test.pyc', '.git/config', 'release/previous.zip',
                'desktop/.env', 'desktop/.env.local', 'packages/example/server-profiles.local.json',
                'desktop/.native-build/app.exe', 'desktop/local.sqlite',
            }
            for name in required | excluded:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'Synthetic source inventory fixture\n')
            entries = {rel.as_posix(): p.read_bytes() for rel, p in module.files()}
            self.assertEqual(set(entries), required)
            archive = Path(temp) / 'source.zip'
            module.archive(archive, entries)
            with zipfile.ZipFile(archive) as z:
                self.assertEqual(set(z.namelist()), required)
                self.assertIsNone(z.testzip())

    def test_release_documentation_inputs_exist_and_copy_exactly(self):
        spec = importlib.util.spec_from_file_location('release_docs_under_test', TOOLS / 'package-release.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        copies = module.documentation_copies()
        self.assertTrue(copies)
        self.assertEqual(len(copies), len(set(copies.values())))
        with tempfile.TemporaryDirectory() as temp:
            for source, name in copies.items():
                with self.subTest(source=source):
                    self.assertTrue(source.is_file(), f'Missing maintained release document: {source}')
                    self.assertEqual(Path(name).name, name)
                    self.assertTrue(source.read_bytes())
                    destination = Path(temp) / name
                    shutil.copyfile(source, destination)
                    self.assertEqual(destination.read_bytes(), source.read_bytes())

if __name__ == '__main__':
    unittest.main()
