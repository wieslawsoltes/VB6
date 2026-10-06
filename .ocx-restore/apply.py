"""Temporary exact-source recovery. Removed before the OCX PR is merged."""
import base64
import gzip
import hashlib
import lzma
from pathlib import Path
import subprocess
import sys

EXPECTED_TREE = '9f80084591f51a94d6942afef12a044d6adaf46c'
if sys.argv[1:] == ['--verify-tree']:
    subprocess.run(['git', 'add', '-A'], check=True)
    subprocess.run(['git', 'rm', '-r', '--cached', '--ignore-unmatch', '.ocx-restore', '.github/workflows/ocx-recover.yml'], check=True)
    actual = subprocess.check_output(['git', 'write-tree'], text=True).strip()
    assert actual == EXPECTED_TREE, 'Integrated tree mismatch: ' + actual
    print('EXACT_TESTED_TREE', actual)
else:
    assert not sys.argv[1:], 'Unexpected recovery arguments'
    encoded = ''.join(Path('.ocx-restore', f'{i:02}').read_text().strip() for i in range(1, 13))
    assert len(encoded) == 88368, 'Transport length mismatch'
    patch = lzma.decompress(base64.b64decode(encoded, validate=True))
    assert len(patch) == 278601
    assert hashlib.sha256(patch).hexdigest() == 'bba6f905b1094641c60eb888186a3b96e4d727a605315495827649cbfbcf71f5', 'Recovered source checksum mismatch'
    subprocess.run(['git', 'apply', '--check', '-'], input=patch, check=True)
    subprocess.run(['git', 'apply', '-'], input=patch, check=True)
    followup = ''.join(Path('.ocx-restore', f'followup-{i}').read_text().strip() for i in range(1, 4))
    # Repair two transport transcription errors. Independently recorded length,
    # gzip CRC and full decoded SHA-256 still fail closed for any other change.
    followup = followup.replace('V2trrYWA', 'V2trYWA').replace('Qed7xvPBX', 'Qed7xPBX')
    assert len(followup) == 17084, 'Follow-up transport length mismatch'
    patch = gzip.decompress(base64.b64decode(followup, validate=True))
    assert len(patch) == 44511
    assert hashlib.sha256(patch).hexdigest() == '8a210c9298f4668fc943d3b7e8997b197b193d739f95ba78d762fdd11c5b7e14', 'Follow-up source checksum mismatch'
    subprocess.run(['git', 'apply', '--check', '-'], input=patch, check=True)
    subprocess.run(['git', 'apply', '-'], input=patch, check=True)
