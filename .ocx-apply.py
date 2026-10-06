from pathlib import Path
import base64
import hashlib
import lzma
import subprocess

encoded = ''.join(Path(f'.ocx-transfer.{i}').read_text().strip() for i in range(1, 7))
patch = lzma.decompress(base64.b64decode(encoded, validate=True))
assert len(patch) == 282161
assert hashlib.sha256(patch).hexdigest() == '11aef00bf9f932a5259a508ab72272616f68735356047506d6284b56f602e136'
path = Path('.ocx-materialized.patch')
path.write_bytes(patch)
subprocess.run(['git', 'apply', '--3way', str(path)], check=True)
path.unlink()
repair = Path('.ocx-repairs.patch')
if repair.exists():
    subprocess.run(['git', 'apply', '--unidiff-zero', str(repair)], check=True)
assert not subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=U']).strip()
print('Verified and applied complete recovered OCX source')
