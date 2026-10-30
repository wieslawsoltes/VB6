#!/usr/bin/env python3
"""Physical navigation priority and disposal regression tests.
Reuses the real IDE fixture; separate reports preserve the authoring evidence.
"""
import importlib.util
import unittest
from pathlib import Path
from playwright.sync_api import expect
from ci.browser_partition import configured_shard, select_case_names

spec=importlib.util.spec_from_file_location('figma_authoring',Path(__file__).with_name('figma-browser-tests.py'))
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.REPORT=base.REPORT/'navigation'

class FigmaNavigation(base.FigmaWorkspace):
    def test_navigation_hand_and_space_take_priority_over_layout_control_drags(self):
        self.enable(True);self.select(['frame']);self.page.locator('[data-auto-property="LayoutMode"]').select_option('1');self.select(['button'])
        designer=self.page.locator('.designer-scroll[data-figma-viewport]')
        for tool in ['hand','space']:
            designer.focus()
            if tool=='hand':self.page.keyboard.press('h')
            else:self.page.keyboard.down('Space')
            before=self.snapshot();history=self.page.evaluate('vb6Studio.history.undoStack.length');selection=self.page.evaluate('[...vb6Studio.designer.selection]')
            state=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
            point=self.page.evaluate('(()=>{const r=vb6Studio.designer.formView.controls.find(v=>v.model.id==="button").node.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()')
            self.page.mouse.move(*point);self.page.mouse.down();self.page.mouse.move(point[0]+60,point[1]+25,steps=5);self.page.mouse.up()
            after=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
            self.assertEqual(self.snapshot(),before,'Canvas navigation must not edit or reparent a flow control')
            self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),history)
            self.assertEqual(self.page.evaluate('[...vb6Studio.designer.selection]'),selection)
            self.assertAlmostEqual(after['x']-state['x'],60);self.assertAlmostEqual(after['y']-state['y'],25)
            if tool=='space':self.page.keyboard.up('Space')
            else:self.page.keyboard.press('Escape')
            expect(designer).to_have_attribute('data-figma-hand','false')
        self.done()
    def test_navigation_capture_releases_to_pointer_editing_and_classic_mode(self):
        self.enable(True);designer=self.page.locator('.designer-scroll[data-figma-viewport]');designer.focus();self.page.keyboard.press('h');self.page.keyboard.press('v')
        for mode in ['figma','classic']:
            if mode=='classic':
                designer.focus();self.page.keyboard.press('h');self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})');self.page.wait_for_timeout(80)
            self.select(['label']);before=self.snapshot();history=self.page.evaluate('vb6Studio.history.undoStack.length')
            point=self.page.evaluate('(()=>{const r=vb6Studio.designer.formView.controls.find(v=>v.model.id==="label").node.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()')
            self.page.mouse.move(*point);self.page.mouse.down();self.page.mouse.move(point[0]+35,point[1]+20,steps=5);self.page.mouse.up();self.page.wait_for_timeout(50)
            self.assertNotEqual(self.snapshot(),before,'Leaving Hand mode must retain canonical pointer editing')
            self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),history+1)
            self.page.evaluate('void vb6Studio.command("undo")');self.page.wait_for_timeout(50);self.assertEqual(self.snapshot(),before)
        self.done()


def load_tests(loader,standard_tests,pattern):
    names=[name for name in sorted(FigmaNavigation.__dict__) if name.startswith('test_navigation_')]
    names=select_case_names(names,configured_shard('figma-authoring'))
    return unittest.TestSuite(FigmaNavigation(name) for name in names)

if __name__=='__main__':unittest.main(verbosity=2)
