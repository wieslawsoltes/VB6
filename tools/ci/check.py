#!/usr/bin/env python3
"""Audit CI ownership and the fail-closed gate; actionlint checks Actions syntax."""
import json
from pathlib import Path
import re
import subprocess
import yaml

ROOT = Path(__file__).resolve().parents[2]
class Loader(yaml.SafeLoader):
    pass
# YAML 1.1 must not treat the Actions `on` key as boolean True.
Loader.yaml_implicit_resolvers = {k: [v for v in vs if v[0] != 'tag:yaml.org,2002:bool']
                                 for k, vs in yaml.SafeLoader.yaml_implicit_resolvers.items()}
Loader.add_implicit_resolver('tag:yaml.org,2002:bool', re.compile(r'^(?:true|false)$', re.I), list('tTfF'))
def mapping(loader, node, deep=False):
    result = {}
    for key, value in node.value:
        name = loader.construct_object(key, deep=deep)
        if name in result:
            raise ValueError('Duplicate YAML key: ' + str(name))
        result[name] = loader.construct_object(value, deep=deep)
    return result
Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)


def audit(root=ROOT):
    folder = root / '.github/workflows'
    paths = sorted([*folder.glob('*.yml'), *folder.glob('*.yaml')])
    if {p.name for p in paths} != {'validate.yml', 'pages.yml', 'macos-aot-runtime.yml'}:
        raise ValueError('Only three maintained workflows are permitted')
    docs = {p.name: yaml.load(p.read_text(), Loader=Loader) for p in paths}
    ci = docs['validate.yml']; jobs = ci['jobs']; gate = jobs['test']; expected = set(jobs) - {'test'}
    gate_step = next(s for s in gate['steps'] if 'tools/ci/gate.mjs' in s.get('run', ''))
    if set(gate['needs']) != expected or set(gate_step['env']['CI_EXPECTED'].split(',')) != expected:
        raise ValueError('Every validation job must reach the required gate')
    if gate.get('if') != 'always()' or ci.get('permissions') != {'contents': 'read'}:
        raise ValueError('Always-running read-only gate required')
    if set(ci['on']) != {'push', 'pull_request', 'workflow_dispatch'} or ci['on']['pull_request']:
        raise ValueError('Required workflow must not disappear behind PR path filters')
    for name, job in jobs.items():
        if job.get('continue-on-error') or any(s.get('continue-on-error') for s in job['steps']):
            raise ValueError('Failure suppression: ' + name)
        if not 1 <= job['timeout-minutes'] <= 30:
            raise ValueError('Unbounded validation job: ' + name)
        if not set(job.get('needs', [])) <= set(jobs):
            raise ValueError('Unknown dependency: ' + name)
        # Matrix-axis checks alone do not notice an excluded engine/origin.
        matrix = job.get('strategy', {}).get('matrix', {})
        if matrix.get('exclude') or matrix.get('include'):
            raise ValueError('Validation matrices must be exhaustive Cartesian products: ' + name)
        for axis, values in matrix.items():
            if not isinstance(values, list) or not values or len(set(values)) != len(values):
                raise ValueError('Empty or duplicate matrix axis: ' + name + '/' + axis)
    def visit(name, ancestors):
        if name in ancestors:
            raise ValueError('Dependency cycle: ' + name)
        for dependency in jobs[name].get('needs', []):
            visit(dependency, ancestors | {name})
    visit('test', set())
    if jobs.get('compute-reference', {}).get('runs-on') != 'windows-latest':
        raise ValueError('Compute native reference must run on Windows')
    if jobs.get('compute-gpu', {}).get('needs') != ['compute-reference']:
        raise ValueError('Compute GPU acceptance must consume the Windows reference')
    compute_steps = jobs['compute-gpu']['steps']
    if not any('npm run test:compute:browser' in step.get('run', '') for step in compute_steps):
        raise ValueError('Actual compute browser execution is required')
    if not any(step.get('uses') == 'actions/download-artifact@v4' and
               step.get('with', {}).get('name') == 'compute-native-reference' for step in compute_steps):
        raise ValueError('Compute acceptance must use this run’s native reference artifact')
    if jobs['node']['strategy']['matrix']['shard'] != [1, 2, 3, 4]:
        raise ValueError('Node shards must partition all four parts')
    if '--test-shard="${SHARD}/4" tests/*.test.mjs' not in (root / '.github/workflows/validate.yml').read_text():
        raise ValueError('Complete Node discovery required')
    for owner in ('browser', 'figma', 'authoring-exports', 'advanced-editor'):
        if set(jobs[owner]['strategy']['matrix']['browser']) != {'chromium', 'firefox', 'webkit'}:
            raise ValueError('Missing engine: ' + owner)
    if set(jobs['figma']['strategy']['matrix']['suite']) != {'figma-authoring', 'figma-services'}:
        raise ValueError('Both disjoint Figma partitions required')
    if set(jobs['figma']['strategy']['matrix']['transport']) != {'http', 'file'}:
        raise ValueError('Both real Figma origins required')
    gpu = jobs['rendering-qualification']['strategy']['matrix']
    if set(gpu['backend']) != {'webgpu', 'webgl2'} or set(gpu['display']) != {'headed', 'headless'}:
        raise ValueError('Missing GPU/display combination')
    if set(jobs['native-com-ole']['strategy']['matrix']['architecture']) != {'x86', 'x64'}:
        raise ValueError('Missing Windows architecture')
    if set(jobs['macos']['strategy']['matrix']['os']) != {'ubuntu-24.04', 'macos-14', 'macos-15', 'macos-26'}:
        raise ValueError('Missing native AOT platform')
    if jobs['macos-browser-native']['needs'] != ['authoring-exports']:
        raise ValueError('Native execution must depend on browser exports')
    if jobs['advanced-editor']['needs'] != ['advanced-build']:
        raise ValueError('All engines must consume the shared actual editor build')
    suites = json.loads((root / 'tools/ci/suites.json').read_text())
    owners = set(jobs['core-browser']['strategy']['matrix']['suite']) | set(jobs['browser']['strategy']['matrix']['suite'])
    owners |= set(jobs['figma']['strategy']['matrix']['suite'])
    owners |= {'authoring-exports', 'advanced-editor', 'code-gpu'}
    if set(suites) != owners:
        raise ValueError('Unowned or missing suite group')
    for group, scripts in suites.items():
        if not scripts or len(scripts) != len(set(scripts)):
            raise ValueError('Empty or duplicate suite: ' + group)
        for script in scripts:
            if not re.fullmatch(r'[a-z][a-z0-9_-]*\.py', script) or not (root / 'tools' / script).is_file():
                raise ValueError('Invalid suite entrypoint: ' + script)
    figma_scripts = [script for group in jobs['figma']['strategy']['matrix']['suite'] for script in suites[group]]
    if len(figma_scripts) != len(set(figma_scripts)):
        raise ValueError('Figma partitions may not duplicate any test entrypoint')
    text = '\n'.join(p.read_text() for p in paths)
    npm = json.loads((root / 'package.json').read_text())['scripts']
    pending = re.findall(r'npm run ([\w:-]+)', text); seen = set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        if name not in npm:
            raise ValueError('Missing npm entrypoint: ' + name)
        seen.add(name); text += '\n' + npm[name]
        pending.extend(re.findall(r'npm run ([\w:-]+)', npm[name]))
    actual = set(re.findall(r'tools/[A-Za-z0-9_/-]+\.(?:py|mjs|ps1)', text))
    actual |= {'tools/' + script for scripts in suites.values() for script in scripts}
    required = json.loads((root / 'tools/ci/coverage.json').read_text())['requiredEntrypoints']
    if missing := set(required) - actual:
        raise ValueError('Lost pre-consolidation entrypoints: ' + ', '.join(sorted(missing)))
    pages = docs['pages.yml']
    if set(pages['on']) != {'workflow_run', 'workflow_dispatch'} or pages['on']['workflow_run']['workflows'] != ['Validate']:
        raise ValueError('Pages must consume successful canonical validation')
    if pages['jobs']['deploy']['permissions'] != {'contents': 'read', 'pages': 'write', 'id-token': 'write'}:
        raise ValueError('Publication permissions must stay in deployment job')
    if pages['jobs']['build']['permissions'] != {'contents': 'read', 'actions': 'read', 'pages': 'read'}:
        raise ValueError('Build may not have publication permissions')
    # Parse every Bash block, including the shared action, without executing it.
    for doc in [*docs.values(), {'jobs': {'composite': yaml.load((root / '.github/actions/setup-browser/action.yml').read_text(), Loader=Loader)['runs']}}]:
        for job in doc['jobs'].values():
            for step in job['steps']:
                shell = step.get('shell', job.get('defaults', {}).get('run', {}).get('shell', doc.get('defaults', {}).get('run', {}).get('shell', 'bash')))
                if 'run' in step and shell == 'bash':
                    script = re.sub(r'\$\{\{.*?\}\}', 'ci_value', step['run'])
                    parsed = subprocess.run(['bash', '-n'], input=script, text=True, capture_output=True)
                    if parsed.returncode:
                        raise ValueError('Invalid Bash block: ' + parsed.stderr)
    return {'workflows': len(paths), 'jobDefinitions': len(jobs), 'preservedEntrypoints': len(required), 'suiteGroups': len(suites)}


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2))
