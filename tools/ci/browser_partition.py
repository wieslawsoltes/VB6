"""Deterministic case ownership for measured, slow browser matrix cells."""

import ast
import os

BROWSER_SHARDS = ('1', '2', '3')
SHARDED_CELLS = {
    ('project-authoring', 'webkit', 'http'),
    ('figma-authoring', 'webkit', 'file'),
    ('figma-services', 'webkit', 'file'),
    ('advanced-editor', 'webkit', 'http'),
    ('advanced-editor', 'webkit', 'file'),
}


def validate_browser_shard(shard, group, engine, transport):
    if shard in (None, ''):
        return ''
    if shard not in BROWSER_SHARDS:
        raise ValueError('Browser shard must be 1, 2 or 3')
    if (group, engine, transport) not in SHARDED_CELLS:
        raise ValueError('Browser shards belong only to the explicitly partitioned WebKit cells')
    return shard


def configured_shard(group):
    return validate_browser_shard(os.environ.get('VB6_BROWSER_SHARD', ''), group,
                                  os.environ.get('VB6_BROWSER', 'chromium'),
                                  os.environ.get('VB6_TEST_TRANSPORT', 'http'))


def select_case_names(case_names, shard='', count=3, allow_empty=False):
    names = list(case_names)
    if (not names or any(not isinstance(name, str) or not name for name in names)
            or len(names) != len(set(names))):
        raise ValueError('Expected a nonempty, unique browser case inventory')
    if type(count) is not int or count < 1:
        raise ValueError('Invalid browser shard count')
    if shard not in ('', *(str(index) for index in range(1, count + 1))):
        raise ValueError('Invalid browser shard')
    names.sort()
    selected = names[int(shard) - 1::count] if shard else names
    if not selected and not allow_empty:
        raise ValueError('A browser shard cannot report success without owned cases')
    return selected


def own_case_names(path, prefix='test_'):
    """Read the one owning class without importing Playwright or a fixture."""
    tree = ast.parse(path.read_text())
    inventories = [[node.name for node in owner.body
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(prefix)]
                   for owner in tree.body if isinstance(owner, ast.ClassDef)]
    inventories = [names for names in inventories if names]
    if len(inventories) != 1:
        raise ValueError('Expected exactly one owning browser test class: ' + path.name)
    return select_case_names(inventories[0])


def project_test_names(case_names, transport='http', shard=''):
    """Keep each case's HTTP/file pair together in one deterministic shard."""
    names = select_case_names(case_names)
    if any(not name.startswith('case_') for name in names):
        raise ValueError('Expected a nonempty, unique native-project case inventory')
    if transport not in ('http', 'file', 'memory'):
        raise ValueError('Unknown native-project transport')
    if shard:
        if transport != 'http':
            raise ValueError('Project shards must retain both real origins')
    names = select_case_names(names, shard)
    origins = ('memory',) if transport == 'memory' else ('http', 'file')
    return sorted('test_' + name[5:] + '_' + origin for name in names for origin in origins)
