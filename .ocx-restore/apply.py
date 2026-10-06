"""Temporary exact-source recovery. Removed before the OCX PR is merged."""
import base64
import hashlib
import lzma
from pathlib import Path
import subprocess
import sys

EXPECTED_TREE = 'd45d2881309eaaa876b065c743a91a938b18a9a8'
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
    # Pass verified bytes directly; no transport payload is executed as code.
    subprocess.run(['git', 'apply', '--check', '-'], input=patch, check=True)
    subprocess.run(['git', 'apply', '-'], input=patch, check=True)
