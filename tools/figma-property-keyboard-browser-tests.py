#!/usr/bin/env python3
"""Native property traversal and the actual user-reported Calculator sample.
Keep this acceptance evidence separate from the general editor/property suite.
"""
import importlib.util
import unittest
from pathlib import Path
from playwright.sync_api import expect
from ci.browser_partition import configured_shard, select_case_names
spec=importlib.util.spec_from_file_location('figma_editor_acceptance',Path(__file__).with_name('figma-editor-browser-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
REPORT=base.REPORT.parent/'keyboard-calculator'
base.REPORT=REPORT
base.base.REPORT=REPORT

class KeyboardCalculator(base.EditorProperties):
    def test_property_tab_commits_once_and_preserves_native_focus_order(self):
        self.enable();self.select(['button'])
        caption=self.property('Caption');before=self.page.evaluate('vb6Studio.history.undoStack.length')
        caption.fill('Keyboard caption');caption.press('Tab')
        expect(self.page.get_by_role('button',name='Edit Caption',exact=True)).to_be_focused()
        self.assertEqual(self.props('button')['Caption'],'Keyboard caption')
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),before+1)
        self.page.keyboard.press('Tab');expect(self.property('Tag')).to_be_focused()
        self.property('Tag').fill('Keyboard tag');self.property('Tag').press('Shift+Tab')
        expect(self.page.get_by_role('button',name='Edit Caption',exact=True)).to_be_focused()
        self.assertEqual(self.props('button')['Tag'],'Keyboard tag')
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),before+2)
        # Native validation modality must retain focus when a Tab commit fails.
        self.page.get_by_label('Search VB6 properties',exact=True).fill('FontSize')
        self.property('FontSize').fill('invalid');self.property('FontSize').press('Tab')
        dialog=self.page.get_by_role('dialog',name='Invalid property value',exact=True)
        expect(dialog).to_be_visible()
        self.assertTrue(dialog.evaluate('(n)=>n.contains(n.ownerDocument.activeElement)'))
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),before+2)
        dialog.get_by_role('button',name='OK',exact=True).click();self.done()

    def test_reported_calculator_sample_code_and_properties(self):
        self.page.evaluate('vb6Studio.loadProject(VB6StudioAPI.EXAMPLES.find(e=>e.id==="calculator").create())')
        self.enable();before=self.snapshot();self.open_code()
        self.page.get_by_label('Search code outline',exact=True).fill('cmdEquals_Click')
        option=self.page.locator('.figma-code-symbol');expect(option).to_have_count(1);option.click()
        self.page.get_by_label('Code view mode',exact=True).select_option('procedure')
        source=self.page.get_by_role('textbox',name='Visual Basic source code',exact=True)
        self.assertIn('Sub cmdEquals_Click()',source.input_value())
        self.assertNotIn('Sub cmdDigit_Click',source.input_value())
        metrics=self.source_metrics();self.assertEqual(metrics['background'],'rgba(0, 0, 0, 0)')
        self.assertEqual(metrics['input'],metrics['syntax'])
        self.page.screenshot(path=str(REPORT/'calculator-code.png'),caret='hide',timeout=10000)
        self.assertEqual(self.snapshot(),before)
        self.page.get_by_label('Search layers',exact=True).fill('cmdEquals')
        row=self.page.get_by_role('treeitem',name='cmdEquals CommandButton',exact=True);row.click()
        expect(self.property('Caption')).to_have_value('=')
        self.property('Caption').fill('Equals');self.property('Caption').press('Tab')
        self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].properties.Caption'),'Equals')
        self.page.get_by_role('button',name='Undo',exact=True).click();self.assertEqual(self.snapshot(),before)
        self.page.screenshot(path=str(REPORT/'calculator-properties.png'),timeout=10000);self.done()


def load_tests(loader,standard_tests,pattern):
    names=[name for name in sorted(KeyboardCalculator.__dict__) if name.startswith('test_')]
    names=select_case_names(names,configured_shard('figma-services'))
    return unittest.TestSuite(KeyboardCalculator(name) for name in names)

if __name__=='__main__':unittest.main(verbosity=2)
