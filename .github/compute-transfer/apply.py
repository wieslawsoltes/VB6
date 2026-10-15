"""Transfer ordinary source only; workflow definitions are connector-authored.
Verify each input and resulting tree. Never update main or the PR branch here.
Retain temporary controls on the transport branch; the clean second-parent
lineage contains only reviewed source and the already-published CI definition.
"""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess

BASE = '7839527082cebb73dfb0e7d428f0cb6869d06c56'
BASE_TREE = '3cd94c31b8019258fc5fa5160c828c10b1f42e5e'
STAGING_PARENT = '7a17b5140b7a4e4aef2d50472d005dfd8f3f0136'
MAIN = '638b5f4a6e5e9feda7e30b435a3720124725ff7c'
BRANCH = 'feat/compute-parity-transfer'
TREES = [
    'd04115e3991a2d8edf4eb3a2a217e0f8bbf9a226',
    'cf4a40a1b5230a6c4ef6bd55a8e3bb56ba0fd770',
    '9eede4e490d11b231716d7455cb60ba8870d6230',
    'ad6ed1e1f5a67eb0437a873490ae46cf23241c0b',
]

def git(*args, data=None):
    return subprocess.check_output(['git', *args], input=data, text=True).strip()

assert os.environ['GITHUB_REPOSITORY'] == 'wieslawsoltes/VB6'
assert os.environ['GITHUB_REF'] == 'refs/heads/' + BRANCH
transport_parent = git('rev-parse', 'HEAD')
assert git('rev-parse', 'HEAD^') == STAGING_PARENT
assert git('rev-parse', BASE + '^{tree}') == BASE_TREE
encoded = ''.join(Path(f'.github/compute-transfer/{i}.b64').read_text() for i in range(4))
compressed = base64.b64decode(encoded, validate=True)
assert hashlib.sha256(compressed).hexdigest() == 'c7f1295091e089fe662cb9258fed83d23aef8b7bd29955355a82f556fce11f66'
payload = lzma.decompress(compressed, memlimit=256 * 1024 * 1024)
assert hashlib.sha256(payload).hexdigest() == '177ae153ea554fd828c6ab0ce2ccd6d93293d34ac5073907a08192b8434e4062'
stages = json.loads(payload)
assert len(stages) == 6
# A transport whitespace normalization is checked against the original patch.
linear = Path('.github/compute-transfer/linear-lookups.patch').read_text().replace('\n diff --git ', '\ndiff --git ')
assert hashlib.sha256(linear.encode()).hexdigest() == 'f4f1792acce0db3b8cb9bb460aecd5f9557fef6e193ba287f104359cefb32b7b'
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
git('read-tree', '--reset', '-u', BASE)
parent = BASE
# CI and contract stages were already published through the connector.
for stage, expected in zip(stages[:4], TREES):
    assert hashlib.sha256(stage['patch'].encode()).hexdigest() == stage['sha256']
    git('apply', '--index', '--unidiff-zero', '-', data=stage['patch'])
    actual = git('write-tree')
    assert actual == expected, (actual, expected)
    parent = git('commit-tree', actual, '-p', parent, data=stage['message'] + '\n')
    print('CLEAN_STAGE', parent, actual, stage['message'], flush=True)
git('apply', '--index', '-', data=linear)
actual = git('write-tree')
assert actual == '165af8ef5c2f3e7d420ba53e01f296af6a367982'
parent = git('commit-tree', actual, '-p', parent,
             data='compute: resolve batch input names in linear rather than quadratic time\n')
print('CLEAN_STAGE', parent, actual, flush=True)
merged_tree = git('merge-tree', '--write-tree', parent, MAIN)
assert len(merged_tree) == 40 and all(c in '0123456789abcdef' for c in merged_tree)
parent = git('commit-tree', merged_tree, '-p', parent, '-p', MAIN,
             data='Merge current main into compute feature for integrated validation\n')
# No new commit may modify a workflow: those writes belong to the connector.
assert not git('diff', BASE, parent, '--', '.github/workflows')
git('read-tree', '--reset', '-u', merged_tree)
git('checkout', transport_parent, '--', '.github/compute-transfer', '.github/workflows/compute-transfer.yml')
transport_tree = git('write-tree')
assert not git('diff', transport_parent, transport_tree, '--', '.github/workflows')
transport = git('commit-tree', transport_tree, '-p', transport_parent, '-p', parent,
                data='Transport exact source-only compute changes and clean feature lineage\n')
git('update-ref', 'HEAD', transport, transport_parent)
assert not git('status', '--porcelain')
git('push', 'origin', transport + ':refs/heads/' + BRANCH)
with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
    output.write(f'clean_sha={parent}\nclean_tree={merged_tree}\n')
print('CLEAN_HEAD', parent, merged_tree, flush=True)
