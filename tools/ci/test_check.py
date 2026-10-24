#!/usr/bin/env python3
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import yaml
import check

class WorkflowAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        shutil.copytree(check.ROOT/'.github',self.root/'.github')
        shutil.copy(check.ROOT/'package.json',self.root/'package.json')
        (self.root/'tools').symlink_to(check.ROOT/'tools',target_is_directory=True)
        (self.root/'tests').mkdir()
        for source in (check.ROOT/'tests').glob('linux-*.test.mjs'):
            shutil.copy(source,self.root/'tests'/source.name)
        self.path=self.root/'.github/workflows/validate.yml'
        self.workflow=yaml.load(self.path.read_text(),Loader=check.Loader)
    def reject(self,mutate):
        value=copy.deepcopy(self.workflow);mutate(value);self.path.write_text(yaml.safe_dump(value,sort_keys=False))
        with self.assertRaises(ValueError):check.audit(self.root)
    def test_complete_graph_passes(self):
        result=check.audit(self.root)
        self.assertEqual(result['preservedEntrypoints'],89)
        self.assertEqual(result['linuxNodeTests'],sorted(p.name for p in (self.root/'tests').glob('linux-*.test.mjs')))
    def test_node_native_runtime_platform_required(self):
        self.reject(lambda w:w['jobs']['node'].update({'runs-on':'ubuntu-latest'}))
    def test_node_native_runtime_dependency_required(self):
        self.reject(lambda w:[s.update({'run':'echo no GTK runtime'}) for s in w['jobs']['node']['steps'] if 'libgtk-3-0t64' in s.get('run','')])
    def test_node_native_runtime_dependency_cannot_be_skipped(self):
        self.reject(lambda w:[s.update({'if':'false'}) for s in w['jobs']['node']['steps'] if 'libgtk-3-0t64' in s.get('run','')])
    def test_node_native_runtime_dependency_must_precede_execution(self):
        def move_install(w):
            steps=w['jobs']['node']['steps']
            install=next(s for s in steps if 'libgtk-3-0t64' in s.get('run',''))
            steps.remove(install);steps.append(install)
        self.reject(move_install)
    def test_node_discovery_must_belong_to_node_job(self):
        def move_discovery(w):
            steps=w['jobs']['node']['steps']
            discovery=next(s for s in steps if '--test-shard=' in s.get('run',''))
            steps.remove(discovery);w['jobs']['hygiene']['steps'].append(discovery)
        self.reject(move_discovery)
    def test_linux_native_test_file_cannot_disappear(self):
        (self.root/'tests/linux-aot-native.test.mjs').unlink()
        with self.assertRaisesRegex(ValueError,'remain discoverable'):check.audit(self.root)
    def test_linux_package_test_discovery_cannot_be_narrowed(self):
        path=self.root/'package.json';package=json.loads(path.read_text())
        package['scripts']['test:linux']='node --test tests/linux-aot.test.mjs'
        path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError,'every Linux Node test'):check.audit(self.root)
    def test_new_linux_test_is_discovered_automatically(self):
        (self.root/'tests/linux-additional.test.mjs').write_text('')
        self.assertIn('linux-additional.test.mjs',check.audit(self.root)['linuxNodeTests'])
    def test_tui_admission_tests_cannot_be_omitted(self):
        self.reject(lambda w:[s.update({'run':s['run'].replace('python tools/ci/test_tui_acceptance.py','')})
                              for s in w['jobs']['hygiene']['steps'] if 'run' in s])
    def test_compute_reference_dependency_required(self):
        self.reject(lambda w:w['jobs']['compute-gpu'].update({'needs':['hygiene']}))
    def test_compute_shader_execution_cannot_be_removed(self):
        self.reject(lambda w:[s.update({'run':'npm run test:compute'}) for s in w['jobs']['compute-gpu']['steps'] if 'npm run test:compute:browser' in s.get('run','')])
    def test_compute_native_reference_download_required(self):
        self.reject(lambda w:[s['with'].update({'name':'unrelated'}) for s in w['jobs']['compute-gpu']['steps'] if s.get('uses')=='actions/download-artifact@v4'])
    def test_gate_omission_rejected(self):self.reject(lambda w:w['jobs']['test']['needs'].remove('macos-browser-native'))
    def test_linux_runtime_rebuild_required(self):
        self.reject(lambda w:[s.update({'run':'npm run test:linux'}) for s in w['jobs']['linux']['steps'] if '--rebuild' in s.get('run','')])
    def test_linux_shipped_runtime_execution_required(self):
        self.reject(lambda w:[s.update({'run':'npm run test:linux'}) for s in w['jobs']['linux']['steps'] if 'tools/test-linux-aot.mjs' in s.get('run','') and '--rebuild' not in s.get('run','')])
    def test_linux_arm64_execution_cannot_be_removed(self):
        self.reject(lambda w:w['jobs']['linux']['strategy']['matrix']['architecture'].remove('arm64'))
    def test_linux_browser_arm64_execution_cannot_be_removed(self):
        self.reject(lambda w:w['jobs']['linux-browser-native']['strategy']['matrix']['architecture'].remove('arm64'))
    def test_linux_package_execution_required(self):
        self.reject(lambda w:[s.update({'run':'npm run test:linux'}) for s in w['jobs']['linux']['steps'] if 'tools/test-linux-distribution.mjs' in s.get('run','')])
    def test_linux_browser_architecture_must_reach_execution(self):
        self.reject(lambda w:[s.update({'run':'node tools/test-linux-browser-artifacts.mjs browser-linux-input'}) for s in w['jobs']['linux-browser-native']['steps'] if 'tools/test-linux-browser-artifacts.mjs' in s.get('run','')])
    def test_linux_printer_dependency_required(self):
        self.reject(lambda w:[s.update({'run':s['run'].replace('libcups2-dev','')}) for s in w['jobs']['linux']['steps'] if 'libcups2-dev' in s.get('run','')])
    def test_linux_runtime_tool_owns_its_gui_display(self):
        self.reject(lambda w:[s.update({'run':'xvfb-run -a '+s['run']}) for s in w['jobs']['linux']['steps'] if 'tools/test-linux-aot.mjs' in s.get('run','')])
    def test_linux_browser_native_requires_artifacts(self):
        self.reject(lambda w:w['jobs']['linux-browser-native'].update({'needs':['hygiene']}))
    def test_linux_browser_native_survives_unrelated_export_suite_failure(self):
        self.reject(lambda w:w['jobs']['linux-browser-native'].pop('if'))
    def test_skippable_gate_rejected(self):self.reject(lambda w:w['jobs']['test'].update({'if':'success()'}))
    def test_failure_suppression_rejected(self):self.reject(lambda w:w['jobs']['figma'].update({'continue-on-error':True}))
    def test_missing_engine_rejected(self):self.reject(lambda w:w['jobs']['figma']['strategy']['matrix']['browser'].remove('webkit'))
    def test_missing_origin_rejected(self):self.reject(lambda w:w['jobs']['figma']['strategy']['matrix']['transport'].remove('file'))
    def test_missing_gpu_display_rejected(self):self.reject(lambda w:w['jobs']['rendering-qualification']['strategy']['matrix']['display'].remove('headed'))
    def test_missing_figma_partition_rejected(self):
        self.reject(lambda w:w['jobs']['figma']['strategy']['matrix']['suite'].remove('figma-services'))
    def test_hidden_matrix_exclusion_rejected(self):
        self.reject(lambda w:w['jobs']['figma']['strategy']['matrix'].update({'exclude':[{'browser':'webkit','transport':'file'}]}))
    def test_duplicate_matrix_value_rejected(self):
        self.reject(lambda w:w['jobs']['node']['strategy']['matrix']['shard'].append(4))
    def test_extra_yaml_extension_workflow_rejected(self):
        (self.root/'.github/workflows/duplicate.yaml').write_text('name: Duplicate\non: push\njobs: {}\n')
        with self.assertRaisesRegex(ValueError,'Only three'):
            check.audit(self.root)
    def test_duplicate_yaml_keys_rejected(self):
        self.path.write_text(self.path.read_text()+'\nname: Invalid\n')
        with self.assertRaisesRegex(ValueError,'Duplicate YAML'):check.audit(self.root)
    def test_path_filtered_required_workflow_rejected(self):self.reject(lambda w:w['on'].update({'pull_request':{'paths':['src/**']}}))
    def test_unowned_suite_rejected(self):self.reject(lambda w:w['jobs']['browser']['strategy']['matrix']['suite'].remove('intelligent-ui'))
    def test_missing_tui_partition_rejected(self):self.reject(lambda w:w['jobs']['browser']['strategy']['matrix']['suite'].remove('tui-authoring'))
    def test_missing_project_authoring_rejected(self):self.reject(lambda w:w['jobs']['browser']['strategy']['matrix']['suite'].remove('project-authoring'))
    def test_dependency_cycle_rejected(self):self.reject(lambda w:w['jobs']['hygiene'].update({'needs':['test']}))
if __name__=='__main__':unittest.main(verbosity=2)
