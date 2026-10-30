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
    # Python audit files are explicitly invoked, unlike the Node glob. Keep
    # the reference-admission and GPU-entrypoint regressions in the required
    # unconditional audit instead of merely shipping an unexecuted test file.
    if not any(step.get('if') is None and
               re.search(r'(?m)^\s*python tools/ci/test_tui_acceptance\.py\s*$', step.get('run', ''))
               for step in jobs['hygiene']['steps']):
        raise ValueError('TUI reference admission tests must execute in the required audit')
    if jobs['node']['strategy']['matrix']['shard'] != [1, 2, 3, 4]:
        raise ValueError('Node shards must partition all four parts')
    if jobs['node'].get('runs-on') != 'ubuntu-24.04':
        raise ValueError('Node shards must support execution of the shipped Linux runtime')
    node_steps = jobs['node']['steps']
    discovery = [i for i, step in enumerate(node_steps)
                 if '--test-shard="${SHARD}/4" tests/*.test.mjs' in step.get('run', '')
                 and 'if' not in step]
    if len(discovery) != 1:
        raise ValueError('Complete unconditional Node discovery required in the Node job')
    if not any('sudo apt-get install -y libgtk-3-0t64 libgtk-4-1 libcups2t64' in step.get('run', '').splitlines()
               and 'if' not in step for step in node_steps[:discovery[0]]):
        raise ValueError('Node shards must install the Linux GTK runtime before executing tests')
    linux_node_tests = sorted(p.name for p in (root / 'tests').glob('linux-*.test.mjs') if p.is_file())
    if not {'linux-aot.test.mjs', 'linux-aot-arm64.test.mjs', 'linux-aot-native.test.mjs', 'linux-aot-printer.test.mjs', 'linux-package.test.mjs', 'linux-distribution.test.mjs', 'linux-gtk4.test.mjs', 'linux-native-distribution.test.mjs'} <= set(linux_node_tests):
        raise ValueError('Linux compiler, native execution and package tests must remain discoverable')
    npm = json.loads((root / 'package.json').read_text())['scripts']
    if npm.get('test:linux') != 'node --test tests/linux-*.test.mjs':
        raise ValueError('Linux package test entrypoint must discover every Linux Node test')
    for owner in ('browser', 'figma', 'authoring-exports', 'advanced-editor'):
        if set(jobs[owner]['strategy']['matrix']['browser']) != {'chromium', 'firefox', 'webkit'}:
            raise ValueError('Missing engine: ' + owner)
    if set(jobs['figma']['strategy']['matrix']['suite']) != {'figma-workspace', 'figma-authoring', 'figma-services'}:
        raise ValueError('All three disjoint Figma partitions required')
    if set(jobs['figma']['strategy']['matrix']['transport']) != {'http', 'file'}:
        raise ValueError('Both real Figma origins required')
    advanced = jobs['advanced-editor']; advanced_matrix = advanced['strategy']['matrix']
    if set(advanced_matrix.get('suite', [])) != {'advanced-editor-core', 'advanced-editor-integration'}:
        raise ValueError('Both disjoint advanced editor partitions required')
    if set(advanced_matrix.get('transport', [])) != {'http', 'file'}:
        raise ValueError('Both real advanced editor origins required')
    if advanced['timeout-minutes'] != 30:
        raise ValueError('Advanced editor partitions retain the validated main-branch thirty-minute job limit')
    if not any(step.get('run') == 'python tools/ci/run.py "$SUITE"' and 'if' not in step and
               step.get('env', {}).get('SUITE') == '${{ matrix.suite }}' and
               step.get('env', {}).get('VB6_TEST_TRANSPORT') == '${{ matrix.transport }}' and
               step.get('env', {}).get('VB6_TEST_ADVANCED') == '1' for step in advanced['steps']):
        raise ValueError('Every advanced partition must run its selected origin with real Monaco enabled')
    if not any(step.get('uses') == 'actions/download-artifact@v4' and 'if' not in step and
               step.get('with', {}).get('name') == 'advanced-editor-assets' for step in advanced['steps']):
        raise ValueError('Advanced editor partitions must consume the actual optional editor build')
    if not any(step.get('uses') == 'actions/upload-artifact@v4' and
               step.get('with', {}).get('name') == '${{ matrix.suite }}-${{ matrix.browser }}-${{ matrix.transport }}'
               for step in advanced['steps']):
        raise ValueError('Advanced editor evidence must have distinct partition, engine and origin names')
    gpu = jobs['rendering-qualification']['strategy']['matrix']
    if set(gpu['backend']) != {'webgpu', 'webgl2'} or set(gpu['display']) != {'headed', 'headless'}:
        raise ValueError('Missing GPU/display combination')
    if set(jobs['native-com-ole']['strategy']['matrix']['architecture']) != {'x86', 'x64'}:
        raise ValueError('Missing Windows architecture')
    if set(jobs['macos']['strategy']['matrix']['os']) != {'ubuntu-24.04', 'macos-15', 'macos-26'}:
        raise ValueError('Missing native AOT platform')
    if set(jobs['macos-browser-native']['strategy']['matrix']['os']) != {'macos-15', 'macos-26'}:
        raise ValueError('Browser-exported native AOT must execute on both supported Apple Silicon platforms')
    if jobs['macos-browser-native']['needs'] != ['authoring-exports']:
        raise ValueError('Native execution must depend on browser exports')
    for owner in ('linux', 'linux-browser-native', 'linux-native-distribution'):
        job = jobs.get(owner, {})
        if job.get('runs-on') != "${{ matrix.architecture == 'arm64' && 'ubuntu-24.04-arm' || 'ubuntu-24.04' }}" or set(job.get('strategy', {}).get('matrix', {}).get('architecture', [])) != {'x64', 'arm64'}:
            raise ValueError('Linux GTK AOT must execute on both declared native architectures')
        if job.get('env', {}).get('ARCHITECTURE') != '${{ matrix.architecture }}':
            raise ValueError('Linux commands must receive the selected native architecture')
    linux_commands = {step.get('run', '').strip() for step in jobs['linux']['steps'] if 'if' not in step}
    if not {'npm run test:linux', 'node tools/test-linux-aot.mjs --architecture "$ARCHITECTURE" --report reports/linux-aot/shipped',
            'node tools/test-linux-aot.mjs --architecture "$ARCHITECTURE" --rebuild --report reports/linux-aot/rebuilt',
            'node tools/test-linux-aot.mjs --architecture "$ARCHITECTURE" --toolkit gtk4 --rebuild --report reports/linux-aot/gtk4-rebuilt',
            'node tools/test-linux-aot.mjs --architecture "$ARCHITECTURE" --toolkit gtk4 --report reports/linux-aot/gtk4-shipped',
            'node tools/test-linux-distribution.mjs --architecture "$ARCHITECTURE" --toolkit gtk4 --report reports/linux-distribution/gtk4',
            'node tools/test-linux-distribution.mjs --architecture "$ARCHITECTURE" --report reports/linux-distribution'} <= linux_commands:
        raise ValueError('Linux must execute shipped and rebuilt runtimes and independently validate native packages')
    if not any(all(package in step.get('run', '').split() for package in ('libgtk-3-dev', 'libgtk-4-dev', 'libcups2-dev'))
               and 'if' not in step for step in jobs['linux']['steps']):
        raise ValueError('Linux qualification requires both GTK development dependencies and CUPS')
    distribution = jobs['linux-native-distribution']
    if set(distribution['strategy']['matrix'].get('toolkit', [])) != {'gtk3', 'gtk4'} or distribution.get('env', {}).get('TOOLKIT') != '${{ matrix.toolkit }}':
        raise ValueError('Native distribution must execute both GTK toolkits')
    distribution_command = 'dbus-run-session -- xvfb-run -a node tools/test-linux-native-distribution.mjs --architecture "$ARCHITECTURE" --toolkit "$TOOLKIT" --flatpak-user-dir "$RUNNER_TEMP/vb6-flatpak" --iso-mount-namespace privileged --report reports/linux-native-distribution'
    if not any(step.get('run') == distribution_command and 'if' not in step for step in distribution['steps']):
        raise ValueError('Native AppImage and sandboxed Flatpak execution, GTK, instances and signing must be mandatory')
    # The session daemon launches Flatpak's portal on demand. Its inherited
    # installation must match the CLI's, including nested glycin image loaders.
    if not any(step.get('run') == distribution_command and
               step.get('env', {}).get('FLATPAK_USER_DIR') == '${{ runner.temp }}/vb6-flatpak'
               for step in distribution['steps']):
        raise ValueError('The Flatpak session daemon and nested sandbox portal must share the isolated installation')
    if not any('flatpak --user install --noninteractive --assumeyes --no-related flathub org.gnome.Platform//50' in step.get('run', '').splitlines()
               and step.get('env', {}).get('FLATPAK_USER_DIR') == '${{ runner.temp }}/vb6-flatpak' and 'if' not in step for step in distribution['steps']):
        raise ValueError('Native Flatpak qualification must install the declared runtime')
    if jobs.get('linux-browser-native', {}).get('needs') != ['authoring-exports']:
        raise ValueError('Linux native execution must consume actual browser exports')
    if jobs['linux-browser-native'].get('if') != '${{ !cancelled() }}':
        raise ValueError('Linux browser artifacts must be verified even after an unrelated export-suite failure')
    if not any(step.get('with', {}).get('pattern') == 'linux-direct-browser-*' for step in jobs['linux-browser-native']['steps']):
        raise ValueError('Linux execution must use this run\'s browser archives')
    if not any(step.get('run') == 'node tools/test-linux-browser-artifacts.mjs browser-linux-input --architecture "$ARCHITECTURE"' and 'if' not in step for step in jobs['linux-browser-native']['steps']):
        raise ValueError('Both native machines must execute their actual browser packages')
    if jobs['advanced-editor']['needs'] != ['advanced-build']:
        raise ValueError('All engines must consume the shared actual editor build')
    suites = json.loads((root / 'tools/ci/suites.json').read_text())
    owners = set(jobs['core-browser']['strategy']['matrix']['suite']) | set(jobs['browser']['strategy']['matrix']['suite'])
    owners |= set(jobs['figma']['strategy']['matrix']['suite'])
    owners |= set(advanced_matrix['suite']) | {'authoring-exports', 'code-gpu'}
    if set(suites) != owners:
        raise ValueError('Unowned or missing suite group')
    for group, scripts in suites.items():
        if not scripts or len(scripts) != len(set(scripts)):
            raise ValueError('Empty or duplicate suite: ' + group)
        for script in scripts:
            if not re.fullmatch(r'[a-z][a-z0-9_-]*\.py', script) or not (root / 'tools' / script).is_file():
                raise ValueError('Invalid suite entrypoint: ' + script)
    # The full DOS palette/DPR/runtime matrix needs its own three-engine job.
    # Combining it with general authoring consumed the shared deadline before
    # its final comparisons ran. Preserve deadlines and every assertion instead.
    browser_groups = jobs['browser']['strategy']['matrix']['suite']
    if 'tui-authoring' not in browser_groups or suites.get('tui-authoring') != ['dos-browser-tests.py']:
        raise ValueError('Dedicated TUI acceptance partition required')
    # Application appearance and core boundaries each need an independent
    # bounded owner; retain every case and the existing interaction deadlines.
    if 'application-appearance' not in browser_groups or suites.get('application-appearance') != ['browser-application-theme-tests.py']:
        raise ValueError('Dedicated application appearance acceptance partition required')
    if jobs['browser']['timeout-minutes'] != 25:
        raise ValueError('Browser partitions retain the twenty-five-minute job limit')
    core_groups = jobs['core-browser']['strategy']['matrix']['suite']
    if 'core-boundaries' not in core_groups or suites.get('core-boundaries') != ['browser-boundaries-06.py']:
        raise ValueError('Dedicated core boundaries acceptance partition required')
    if suites.get('core-recovery') != ['recovery-browser-tests.py', 'browser-finalization-05.py']:
        raise ValueError('Core recovery must retain both recovery and finalization suites')
    if jobs['core-browser']['timeout-minutes'] != 15:
        raise ValueError('Core partitions retain the fifteen-minute job limit')
    core_scripts = [script for group in core_groups for script in suites[group]]
    if len(core_scripts) != len(set(core_scripts)):
        raise ValueError('Core partitions may not duplicate any test entrypoint')
    browser_scripts = [script for group in browser_groups for script in suites[group]]
    if len(browser_scripts) != len(set(browser_scripts)):
        raise ValueError('Browser partitions may not duplicate any test entrypoint')
    figma_scripts = [script for group in jobs['figma']['strategy']['matrix']['suite'] for script in suites[group]]
    if suites.get('figma-workspace') != ['figma-browser-tests.py']:
        raise ValueError('Dedicated Figma workspace acceptance partition required')
    if len(figma_scripts) != len(set(figma_scripts)):
        raise ValueError('Figma partitions may not duplicate any test entrypoint')
    if suites.get('advanced-editor-core') != ['browser-advanced-editor-tests.py'] or suites.get('advanced-editor-integration') != [
            'browser-input-modes-tests.py', 'browser-tui-advanced-tests.py', 'figma-advanced-editor-browser-tests.py']:
        raise ValueError('Balanced advanced editor partitions must preserve all four independent suites')
    text = '\n'.join(p.read_text() for p in paths)
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
    return {'workflows': len(paths), 'jobDefinitions': len(jobs), 'preservedEntrypoints': len(required),
            'suiteGroups': len(suites), 'linuxNodeTests': linux_node_tests}


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2))
