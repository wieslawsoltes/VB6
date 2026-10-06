import base64
import gzip
import hashlib
import pathlib
import subprocess

payloads = [
    ('candidate', 3, 'c3edb765cd6725607888ba7a5735ea0dd4c97ea58fcda776818d014e25718df1'),
    ('designer', 2, '3f7018e96d137f27d3a5235174d276b425626ac199560edad750daaa24871fed'),
]
for name, count, digest in payloads:
    data = ''.join(pathlib.Path(f'.ocx-{name}.{i}').read_text().strip() for i in range(1, count + 1))
    if name == 'designer':
        # Correct a transport transcription; the decoded source must still match
        # the independently recorded complete SHA-256, otherwise fail closed.
        data = data.replace('p2kaxvH1b+n6', 'p2kaxv1b+n6')
    patch = gzip.decompress(base64.b64decode(data, validate=True))
    assert hashlib.sha256(patch).hexdigest() == digest, f'{name} source checksum mismatch'
    path = pathlib.Path(f'ocx-{name}.patch')
    path.write_bytes(patch)
    subprocess.run(['git', 'apply', '--unidiff-zero', str(path)], check=True)
    path.unlink()
    if name == 'candidate':
        subprocess.run(['git', 'apply', '--unidiff-zero', '.ocx-repair.patch'], check=True)
