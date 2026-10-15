"""One-time transport of reviewed, hash-checked patches; never part of main.
The compressed payload contains six ordinary git patches and their exact trees.
Only this temporary branch is pushed. The clean feature lineage is a separate
parent, starting at the existing reviewed feature commit, and is validated by
read-only jobs before any feature ref update or merge.
"""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess

BASE = '69a6903d422def6a1072d831e201d0d3bbf3fb46'
MAIN = '638b5f4a6e5e9feda7e30b435a3720124725ff7c'
BRANCH = 'feat/compute-parity-transfer'
TREES = [
    'ad138bd11333664bde4a71294b9433eeb6c5576a',
    'd7b134022cb3cf039e52cedb7bde1579526f60c1',
    'ee0b58e2bdd0d995351b8c4ce2f579d9bd3cd2ee',
    '9cc59ee5b7a45cd7463244fd08ff217073a1b355',
    '633d8e09645008a58b0e55bf91f61ddfa752548e',
    'ad6ed1e1f5a67eb0437a873490ae46cf23241c0b',
]

def git(*args, data=None):
    return subprocess.check_output(['git', *args], input=data, text=True).strip()

assert os.environ['GITHUB_REPOSITORY'] == 'wieslawsoltes/VB6'
assert os.environ['GITHUB_REF'] == 'refs/heads/' + BRANCH
transport_parent = git('rev-parse', 'HEAD')
assert git('rev-parse', 'HEAD^') == BASE
assert git('rev-parse', BASE + '^{tree}') == 'c4d753bd265c83dc08c127d783824cb5fede3f31'
encoded = ''.join(Path(f'.github/compute-transfer/{i}.b64').read_text() for i in range(4))
compressed = base64.b64decode(encoded, validate=True)
assert hashlib.sha256(compressed).hexdigest() == 'c7f1295091e089fe662cb9258fed83d23aef8b7bd29955355a82f556fce11f66'
payload = lzma.decompress(compressed, memlimit=256 * 1024 * 1024)
assert hashlib.sha256(payload).hexdigest() == '177ae153ea554fd828c6ab0ce2ccd6d93293d34ac5073907a08192b8434e4062'
stages = json.loads(payload)
assert len(stages) == len(TREES)
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
# Drop every temporary payload/workflow file from both index and worktree.
git('read-tree', '--reset', '-u', BASE)
parent = BASE
for stage, expected in zip(stages, TREES):
    assert hashlib.sha256(stage['patch'].encode()).hexdigest() == stage['sha256']
    git('apply', '--index', '--unidiff-zero', '-', data=stage['patch'])
    actual = git('write-tree')
    assert actual == expected == stage['tree'], (actual, expected)
    parent = git('commit-tree', actual, '-p', parent, data=stage['message'] + '\n')
    print('CLEAN_STAGE', parent, actual, stage['message'], flush=True)
# Preserve the independently merged current-main changes, without touching main.
# merge-tree exits nonzero on a conflict; no conflict resolution is automated.
merged_tree = git('merge-tree', '--write-tree', parent, MAIN)
assert len(merged_tree) == 40 and all(c in '0123456789abcdef' for c in merged_tree)
parent = git('commit-tree', merged_tree, '-p', parent, '-p', MAIN,
             data='Merge current main into compute feature for integrated validation\n')
git('read-tree', '--reset', '-u', merged_tree)
transport = git('commit-tree', merged_tree, '-p', transport_parent, '-p', parent,
                data='Transport exact compute source with clean feature lineage\n')
git('update-ref', 'HEAD', transport, transport_parent)
assert not git('status', '--porcelain')
git('push', 'origin', transport + ':refs/heads/' + BRANCH)
with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
    output.write(f'clean_sha={parent}\nclean_tree={merged_tree}\n')
print('CLEAN_HEAD', parent, merged_tree, flush=True)
