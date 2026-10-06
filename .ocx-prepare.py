import base64, gzip, hashlib, pathlib, subprocess
parts = [f'.ocx-source.{i}' for i in range(1, 7)]
encoded = ''.join(pathlib.Path(path).read_text().strip() for path in parts)
patch = gzip.decompress(base64.b64decode(encoded, validate=True))
assert hashlib.sha256(patch).hexdigest() == '1f61f90c58188815f5ea11c8947604aa2bd6dfb6484838bd3fcf22e03dc85029', 'Source checksum mismatch'
subprocess.run(['git', 'apply', '--index', '--unidiff-zero', '-'], input=patch, check=True)
subprocess.run(['git', 'rm', '--cached', '--', *parts, '.ocx-prepare.py', '.github/workflows/ocx-reconcile-snapshot.yml'], check=True)
actual = subprocess.check_output(['git', 'write-tree'], text=True).strip()
assert actual == '5860f87e629ccba682ed87d5c63d8fd4591c7e94', f'Unexpected complete source tree: {actual}'
subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
print('EXACT_TESTED_SOURCE_TREE', actual)
