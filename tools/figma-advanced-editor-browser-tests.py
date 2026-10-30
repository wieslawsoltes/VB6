#!/usr/bin/env python3
"""Figma Code sidebar against the actual optional Monaco build and shared harness.
Keep reports separate from the full advanced-editor acceptance suite.
"""
import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('advanced_acceptance',Path(__file__).with_name('browser-advanced-editor-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.REPORT=base.REPORT/'figma'

class FigmaAdvancedEditor(base.AdvancedEditorAcceptance):
    def test_figma_code_panel_preserves_real_monaco_editing(self):
        self.enable();before=self.text()
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma",scheme:"dark"})')
        self.page.get_by_role('region',name='Code inspector').wait_for(state='visible')
        self.page.get_by_role('button',name='Split code editor',exact=True).click()
        self.assertEqual(self.page.evaluate('s.views.length'),2)
        self.page.get_by_label('Go to code line',exact=True).fill('4')
        self.page.get_by_role('button',name='Go to line',exact=True).click()
        self.assertEqual(self.page.evaluate('s.view.getPosition().lineNumber'),4)
        self.page.evaluate('s.select(s.record.model.getValueLength())')
        self.page.keyboard.insert_text("' Figma + Monaco\n")
        self.assertTrue(self.text().endswith("' Figma + Monaco\n"))
        self.page.keyboard.press('Control+z');self.assertEqual(self.text(),before)
        self.assertTrue(self.page.get_by_label('Code view mode',exact=True).is_disabled())
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertEqual(self.text(),before);self.assertEqual(self.page.evaluate('s.views.length'),2)
        self.done()

def load_tests(loader,standard_tests,pattern):
    names=[name for name in FigmaAdvancedEditor.__dict__ if name.startswith('test_')]
    return unittest.TestSuite(FigmaAdvancedEditor(name) for name in base.select_case_names(names,base.configured_shard('advanced-editor')))

if __name__=='__main__':unittest.main(verbosity=2)
