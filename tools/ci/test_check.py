#!/usr/bin/env python3
import copy
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
        self.path=self.root/'.github/workflows/validate.yml'
        self.workflow=yaml.load(self.path.read_text(),Loader=check.Loader)
    def reject(self,mutate):
        value=copy.deepcopy(self.workflow);mutate(value);self.path.write_text(yaml.safe_dump(value,sort_keys=False))
        with self.assertRaises(ValueError):check.audit(self.root)
    def test_complete_graph_passes(self):self.assertEqual(check.audit(self.root)['preservedEntrypoints'],82)
    def test_gate_omission_rejected(self):self.reject(lambda w:w['jobs']['test']['needs'].remove('macos-browser-native'))
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
    def test_dependency_cycle_rejected(self):self.reject(lambda w:w['jobs']['hygiene'].update({'needs':['test']}))
if __name__=='__main__':unittest.main(verbosity=2)
