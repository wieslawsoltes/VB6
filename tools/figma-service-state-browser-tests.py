#!/usr/bin/env python3
"""Tool tab selection and Assets navigation state use their real UI owners."""
import importlib.util
import json
import unittest
from pathlib import Path
from playwright.sync_api import expect
from ci.browser_partition import configured_shard, select_case_names
spec=importlib.util.spec_from_file_location('services',Path(__file__).with_name('figma-services-browser-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.base.REPORT=base.base.REPORT/'state'

class ServiceState(base.ServicesAssets):
    def setUp(self):
        super().setUp()
        if self._testMethodName in (
                'test_failed_pointer_capture_reports_error_and_allows_next_placement',
                'test_rejected_pointer_drop_restores_pan_and_releases_session'):
            self.page.evaluate(Path(__file__).with_name('figma-gesture-trace.js').read_text())

    def tearDown(self):
        try:
            records=self.page.evaluate('window.testAssetGestureRecords || null')
            if records is not None:
                (base.base.REPORT/(self._testMethodName+'-gesture.json')).write_text(json.dumps(records,indent=2))
        finally:
            super().tearDown()

    def test_expanded_tool_has_the_only_selected_and_highlighted_document_tab(self):
        self.enable();self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.get_by_role('button',name='Expand Agent to document',exact=True).click()
        tab=self.page.locator('[data-figma-tool-tab="tool:coding-agents"]')
        expect(tab).to_be_visible();expect(tab).to_have_class('document-tab active')
        expect(self.page.locator('.document-tabs [aria-selected="true"]')).to_have_count(1)
        self.page.locator('.document-tab[data-document$=":form"]').click()
        expect(tab).not_to_have_class('document-tab active')
        expect(self.page.locator('.document-tabs [aria-selected="true"]')).to_have_count(1)
        tab.click();expect(tab).to_have_class('document-tab active')
        self.page.get_by_role('button',name='Agent',exact=True).click()
        expect(tab).to_have_count(0)
        expect(self.page.locator('.document-tab[data-document$=":form"]')).to_have_class('document-tab active')
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        expect(self.page.locator('.document-tabs [aria-selected="true"]')).to_have_count(1)
        self.done()

    def test_successful_asset_drop_leaves_hand_mode_and_selects_new_control(self):
        self.enable();self.page.get_by_role('button',name='Hand (H)',exact=True).click()
        self.assertTrue(self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).hand'))
        self.drop_asset('Label','.mdi-active .vb-form-content',300,5400)
        self.assertEqual(self.inserted()['type'],'Label')
        self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).hand'))
        expect(self.page.get_by_role('button',name='Move (V)',exact=True)).to_have_attribute('aria-pressed','true')
        self.done()

    def test_cancelled_native_drag_restores_its_edge_pan(self):
        self.enable();source=self.asset('Label');r=source.bounding_box()
        viewport=self.page.locator('.designer-scroll[data-figma-viewport]').bounding_box()
        before=self.snapshot();state=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        self.page.mouse.move(r['x']+r['width']/2,r['y']+20);self.page.mouse.down()
        self.page.mouse.move(r['x']+r['width']/2+10,r['y']+30,steps=3)
        self.page.mouse.move(viewport['x']+viewport['width']-8,viewport['y']+viewport['height']/2,steps=10)
        # Native dragover is delivered on movement after dragenter.
        self.page.mouse.move(viewport['x']+viewport['width']-7,viewport['y']+viewport['height']/2)
        self.page.wait_for_function('x=>vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state.x<x-20',arg=state['x'])
        self.assertEqual(self.snapshot(),before)
        self.page.keyboard.press('Escape');self.page.mouse.up()
        self.page.wait_for_function('!vb6Studio.figmaMode.ui.assets.active')
        restored=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        self.assertAlmostEqual(restored['x'],state['x'],places=4)
        self.assertAlmostEqual(restored['y'],state['y'],places=4)
        self.assertEqual(self.snapshot(),before);self.done()



    def test_short_docks_keep_agent_composer_and_mcp_catalog_reachable(self):
        self.enable();self.page.set_viewport_size({'width':1400,'height':800})
        self.page.get_by_role('button',name='Code',exact=True).click()
        self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.get_by_role('button',name='MCP',exact=True).click()
        self.page.get_by_role('tab',name='Capabilities',exact=True).click()
        for selector in ['.figma-host-content .agent-task','.figma-host-content .mcp-catalog-page']:
            pane=self.page.locator(selector);rect=pane.bounding_box()
            self.assertGreater(pane.evaluate('n=>n.scrollHeight-n.clientHeight'),0)
            self.page.mouse.move(rect['x']+12,rect['y']+12)
            self.page.mouse.wheel(0,1600)
            self.page.wait_for_function('selector=>document.querySelector(selector).scrollTop>0',arg=selector)
        prompt=self.page.get_by_label('Agent task',exact=True)
        prompt.fill('Draft in a short tool dock')
        self.assertEqual(prompt.input_value(),'Draft in a short tool dock')
        self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled||vb6Studio.codingAgents.agent.busy'))
        self.page.screenshot(path=str(base.base.REPORT/'short-tool-docks.png'))
        self.done()



    def test_native_drag_from_card_padding_preserves_button_and_classic_children(self):
        self.enable();source=self.asset('Label')
        surface=source.locator('.figma-asset-drag-surface');expect(surface).to_have_count(1)
        geometry=source.evaluate("n=>{const a=n.getBoundingClientRect(),b=n.firstElementChild.getBoundingClientRect();return [a.width,a.height,b.width,b.height];}")
        self.assertAlmostEqual(geometry[0],geometry[2],delta=1)
        self.assertAlmostEqual(geometry[1],geometry[3],delta=1)
        before=self.snapshot();count=self.page.evaluate('vb6Studio.history.undoStack.length')
        target=self.page.locator('.mdi-active .vb-form-content');r=target.bounding_box()
        source.drag_to(target,source_position={'x':2,'y':2},target_position={'x':20,'y':r['height']-40})
        self.assertEqual(self.inserted()['type'],'Label')
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
        self.page.evaluate('void vb6Studio.command("undo")');self.assertEqual(self.snapshot(),before)
        self.page.evaluate("window.testAssetButton=document.querySelector('.toolbox-grid [data-control-type=Label]')")
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertEqual(self.page.locator('.figma-asset-drag-surface').count(),0)
        self.assertTrue(self.page.evaluate('testAssetButton.querySelector(".figma-asset-drag-surface")===null'))
        self.assertEqual(self.page.evaluate('testAssetButton.tagName'),'BUTTON');self.done()

    def test_workspace_resize_observers_schedule_paint_without_synchronous_dom_writes(self):
        self.page.evaluate("""()=>{
          const Native=window.ResizeObserver;window.figmaResizeAudit=[];
          window.ResizeObserver=class extends Native {
            constructor(callback){super((entries,observer)=>{
              const targets=entries.filter(e=>e.target.matches('.figma-layer-tree,.figma-code-outline'));
              if(!targets.length)return callback(entries,observer);
              const mutations=new MutationObserver(()=>{});
              mutations.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
              try {callback(entries,observer);}
              finally {
                window.figmaResizeAudit.push({targets:targets.map(e=>e.target.className),writes:mutations.takeRecords().length});
                mutations.disconnect();
              }
            });}
          };
        }""")
        self.enable();self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.get_by_role('button',name='MCP',exact=True).click()
        self.page.get_by_role('button',name='Code',exact=True).click()
        self.page.set_viewport_size({'width':1400,'height':800})
        self.page.wait_for_function('figmaResizeAudit.some(r=>r.targets.includes("figma-code-outline"))')
        audit=self.page.evaluate('figmaResizeAudit')
        self.assertGreater(len(audit),0)
        self.assertEqual(sum(row['writes'] for row in audit),0)
        self.done()



    def test_rejected_native_drop_restores_pan_and_releases_session(self):
        self.assert_rejected_drop_cleanup('native')

    def test_rejected_pointer_drop_restores_pan_and_releases_session(self):
        self.assert_rejected_drop_cleanup('pointer')

    def move_to_visible_form_client(self):
        # The form can be partially clipped behind Assets after edge panning.
        # A getBoundingClientRect-relative point need not be a reachable target.
        # First leave the edge band with physical input, then sample the visible
        # intersection. Do not stop the app's RAF, set its pan or dispatch events.
        canvas=self.page.locator('.designer-scroll[data-figma-viewport]').bounding_box()
        self.page.mouse.move(canvas['x']+canvas['width']/2,canvas['y']+canvas['height']/2)
        target=self.page.locator('.mdi-active .vb-form-content').bounding_box()
        left=max(target['x'],canvas['x']+40)
        right=min(target['x']+target['width'],canvas['x']+canvas['width']-40)
        top=max(target['y'],canvas['y']+40)
        bottom=min(target['y']+target['height'],canvas['y']+canvas['height']-70)
        self.assertGreater(right-left,80,'A visible client surface is required for this drop')
        self.assertGreater(bottom-top,80,'A visible client surface is required for this drop')
        x,y=(left+right)/2,bottom-30
        self.page.mouse.move(x,y)
        self.page.mouse.move(x+1,y)  # Native dragover follows dragenter.
        self.assertTrue(self.page.evaluate("""([x,y])=>{
          const d=vb6Studio.designer,n=document.elementFromPoint(x,y);
          return !!n&&d.root.contains(n)&&d.formView.content.contains(n);
        }""",[x+1,y]),'Release must hit the actual form client, not a clipped border or sidebar')

    def assert_rejected_drop_cleanup(self,kind):
        self.enable()
        source=self.asset('Label')
        if kind=='pointer':source=self.page.get_by_role('button',name='Place Label on designer',exact=True)
        source.hover();r=source.bounding_box()
        viewport=self.page.locator('.designer-scroll[data-figma-viewport]').bounding_box()
        before=self.snapshot();history=self.page.evaluate('vb6Studio.history.undoStack.length')
        state=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        # A registered component validator is allowed to reject insertion.
        # Inject that failure, not synthetic application drag/drop events.
        self.page.evaluate("""()=>{
          const registry=vb6Studio.controlRegistry;
          window.originalAssetValidation=registry.validateProperties;
          registry.validateProperties=function(type,values){
            if(type==='Label')throw new Error('Test component rejected insertion');
            return window.originalAssetValidation.call(this,type,values);
          };
        }""")
        self.page.mouse.move(r['x']+r['width']/2,r['y']+20);self.page.mouse.down()
        self.page.mouse.move(r['x']+r['width']/2+10,r['y']+30,steps=3)
        self.page.mouse.move(viewport['x']+viewport['width']-8,viewport['y']+viewport['height']/2,steps=10)
        self.page.mouse.move(viewport['x']+viewport['width']-7,viewport['y']+viewport['height']/2)
        self.page.wait_for_function('x=>vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state.x<x-20',arg=state['x'])
        self.move_to_visible_form_client();self.page.mouse.up()
        dialog=self.page.get_by_role('dialog',name='Figma workspace',exact=True)
        expect(dialog).to_be_visible();expect(dialog).to_contain_text('Test component rejected insertion')
        self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.ui.assets.active'))
        expect(self.page.locator('.figma-asset-ghost')).not_to_be_visible()
        restored=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        self.assertAlmostEqual(restored['x'],state['x'],places=4)
        self.assertAlmostEqual(restored['y'],state['y'],places=4)
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),history)
        self.page.wait_for_timeout(150)
        self.assertEqual(self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state'),restored)
        self.page.evaluate('void (vb6Studio.controlRegistry.validateProperties=window.originalAssetValidation)')
        dialog.get_by_role('button',name='OK',exact=True).click()
        self.drop_asset('Label','.mdi-active .vb-form-content',450,5400)
        self.assertEqual(self.inserted()['type'],'Label')
        self.page.evaluate('void vb6Studio.command("undo")');self.assertEqual(self.snapshot(),before)
        self.done()

    def test_failed_pointer_capture_reports_error_and_allows_next_placement(self):
        self.enable();self.asset('TextBox')
        before=self.snapshot();history=self.page.evaluate('vb6Studio.history.undoStack.length')
        self.page.evaluate("""()=>{
          const root=vb6Studio.root;window.originalAssetCapture=root.setPointerCapture;
          root.setPointerCapture=function(){throw new DOMException('Test pointer is no longer active','NotFoundError');};
        }""")
        grip=self.page.get_by_role('button',name='Place TextBox on designer',exact=True)
        r=grip.bounding_box();self.page.mouse.move(r['x']+r['width']/2,r['y']+20);self.page.mouse.down();self.page.mouse.up()
        dialog=self.page.get_by_role('dialog',name='Figma workspace',exact=True)
        expect(dialog).to_be_visible();expect(dialog).to_contain_text('Test pointer is no longer active')
        self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.ui.assets.active'))
        expect(self.page.locator('.figma-asset-ghost')).not_to_be_visible()
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),history)
        self.page.evaluate('void (vb6Studio.root.setPointerCapture=window.originalAssetCapture)')
        dialog.get_by_role('button',name='OK',exact=True).click()
        r=grip.bounding_box()
        self.page.mouse.move(r['x']+r['width']/2,r['y']+20);self.page.mouse.down()
        self.move_to_visible_form_client();self.page.mouse.up()
        self.assertEqual(self.inserted()['type'],'TextBox')
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),history+1)
        self.done()


def load_tests(loader,standard,pattern):
    names=[name for name in sorted(ServiceState.__dict__) if name.startswith('test_')]
    names=select_case_names(names,configured_shard('figma-services'))
    return unittest.TestSuite(ServiceState(name) for name in names)
if __name__=='__main__':unittest.main(verbosity=2)
