#!/usr/bin/env python3
"""Live Figma service views and real Assets placement; no provider calls needed."""
import importlib.util
import unittest
from pathlib import Path
from playwright.sync_api import expect
spec=importlib.util.spec_from_file_location('figma_base',Path(__file__).with_name('figma-browser-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.REPORT=base.REPORT/'services-assets'

class ServicesAssets(base.FigmaWorkspace):
    def asset(self,type):
        self.page.locator('.dock-tabbar [data-window-id="toolbox"]').click()
        self.page.get_by_label('Search VB6 controls',exact=True).fill(type)
        return self.page.locator('.toolbox-grid [data-control-type="'+type+'"]')
    def inserted(self):return self.page.evaluate('vb6Studio.designer.selected()[0]')
    def drop_asset(self,type,container,x,y):
        source=self.asset(type)
        target=self.page.locator(container)
        zoom=self.page.evaluate('vb6Studio.designer.zoom')
        source.drag_to(target,target_position={'x':x/15*zoom,'y':y/15*zoom})
        self.page.wait_for_timeout(80)

    def test_agent_is_live_beside_designer_and_restores_classic_identity(self):
        self.page.evaluate('window.agentPanel=vb6Studio.codingAgents.open();agentPanel.prompt.value="Keep my draft";agentPanel.keyInput.value="local-test-key";vb6Studio.openDocument(vb6Studio.activeModule.id,"form")')
        before=self.snapshot();self.enable()
        self.page.get_by_role('button',name='Agent',exact=True).click()
        expect(self.page.get_by_label('Agent task',exact=True)).to_have_value('Keep my draft')
        self.assertTrue(self.page.evaluate('vb6Studio.figmaMode.currentDesigner()!=null'))
        self.assertTrue(self.page.evaluate('agentPanel===vb6Studio.documents.tools.get("tool:coding-agents")'))
        self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled'))
        self.assertEqual(before,self.snapshot())
        self.page.screenshot(path=str(base.REPORT/'agent-beside-designer.png'))
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertEqual(self.page.evaluate('agentPanel.prompt.value'),'Keep my draft')
        self.assertEqual(self.page.evaluate('agentPanel.keyInput.value'),'local-test-key')
        self.assertTrue(self.page.evaluate('vb6Studio.documents.mdi.windows.get("tool:coding-agents").node.contains(agentPanel.root)'))
        self.assertEqual(self.page.locator('.figma-hosted-tool').count(),0);self.done()

    def test_review_context_appends_draft_without_sharing_or_starting(self):
        self.enable();self.select(['button']);self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.get_by_label('Agent task',exact=True).fill('Please preserve my instructions.')
        before=self.snapshot()
        self.page.get_by_role('button',name='Review selection for agent',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='Review authoring context',exact=True)
        context=dialog.get_by_label('Reviewed authoring context',exact=True).input_value()
        self.assertIn('Command1',context);self.assertNotIn('"Text":',context)
        dialog.get_by_role('button',name='Append to draft',exact=True).click()
        draft=self.page.get_by_label('Agent task',exact=True).input_value()
        self.assertTrue(draft.startswith('Please preserve my instructions.'));self.assertIn('Command1',draft)
        self.assertFalse(self.page.evaluate('vb6Studio.codingAgents.agent.busy'))
        self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled'));self.assertEqual(before,self.snapshot());self.done()

    def test_mcp_pages_use_real_server_and_original_permission_ui(self):
        self.enable();before=self.snapshot();self.page.get_by_role('button',name='MCP',exact=True).click()
        expect(self.page.get_by_label('Enable MCP sharing',exact=True)).not_to_be_checked()
        self.page.get_by_role('tab',name='Capabilities',exact=True).click()
        expect(self.page.locator('.figma-host-content .mcp-catalog')).to_be_visible()
        self.assertTrue(self.page.evaluate('vb6Studio.figmaMode.currentDesigner()!=null'))
        self.page.get_by_role('button',name='Stop MCP sharing',exact=True).click()
        self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled'));self.assertEqual(before,self.snapshot())
        self.page.screenshot(path=str(base.REPORT/'mcp-beside-designer.png'));self.done()

    def test_tool_expansion_rehosting_and_close_are_real(self):
        self.enable();self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.get_by_label('Agent task',exact=True).fill('Draft survives expansion')
        self.page.get_by_role('button',name='Expand Agent to document',exact=True).click()
        expect(self.page.locator('[data-figma-tool-tab="tool:coding-agents"]')).to_be_visible()
        self.assertEqual(self.page.evaluate('vb6Studio.documents.mdi.active'),'tool:coding-agents')
        self.page.get_by_role('button',name='Agent',exact=True).click()
        expect(self.page.locator('.figma-host-content [aria-label="Agent task"]')).to_have_value('Draft survives expansion')
        self.assertTrue(self.page.evaluate('vb6Studio.figmaMode.currentDesigner()!=null'))
        self.page.get_by_role('button',name='MCP',exact=True).click()
        self.page.locator('.mcp-footer').get_by_role('button',name='Close',exact=True).click()
        self.assertFalse(self.page.evaluate('vb6Studio.documents.tools.has("tool:mcp")'));self.done()

    def test_search_view_navigates_real_source_and_survives_mode_switch(self):
        self.enable();self.page.get_by_role('button',name='Tools',exact=True).click()
        self.page.get_by_role('menuitem',name='Search',exact=True).click()
        self.page.get_by_label('Find in project',exact=True).fill('Command1')
        self.page.get_by_role('button',name='Find all in project',exact=True).click()
        self.assertGreater(self.page.evaluate('vb6Studio.documents.tools.get("tool:project-search").result.hits.length'),0)
        self.page.evaluate('vb6Studio.documents.tools.get("tool:project-search").navigate(vb6Studio.documents.tools.get("tool:project-search").result.hits[0])')
        self.assertEqual(self.page.evaluate('vb6Studio.activeDoc.view'),'code')
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertEqual(self.page.get_by_label('Find in project',exact=True).input_value(),'Command1');self.done()

    def test_project_replacement_preserves_agent_owner_and_clears_stale_tools(self):
        self.enable();self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.evaluate('window.agentPanel=vb6Studio.documents.tools.get("tool:coding-agents")')
        self.page.evaluate(base.FIXTURE,False)
        self.page.get_by_role('button',name='Agent',exact=True).click()
        self.assertTrue(self.page.evaluate('agentPanel===vb6Studio.documents.tools.get("tool:coding-agents")'))
        self.assertEqual(self.page.locator('.agent-panel').count(),1)
        self.assertFalse(self.page.evaluate('vb6Studio.codingAgents.agent.busy'));self.done()

    def test_native_asset_drop_respects_zoom_root_coordinates_and_single_undo(self):
        self.enable();self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).zoom(.75)')
        before=self.snapshot();history=self.page.evaluate('vb6Studio.history.undoStack.length')
        self.drop_asset('CommandButton','.mdi-active .vb-form-content',300,5400)
        control=self.inserted();self.assertEqual(control['type'],'CommandButton');self.assertIsNone(control['parent'])
        self.assertAlmostEqual(control['properties']['Left'],300,delta=15);self.assertAlmostEqual(control['properties']['Top'],5400,delta=15)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),history+1)
        self.page.evaluate('void vb6Studio.command("undo")');self.assertEqual(self.snapshot(),before);self.done()

    def test_native_nested_container_drop_uses_client_origin(self):
        self.enable();self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).zoom(1.25)')
        self.drop_asset('TextBox','.mdi-active [data-control-id="frame"]>.vb-frame-client',450,2400)
        control=self.inserted();self.assertEqual(control['parent'],'Frame1');self.assertEqual(control['nativeParentId'],'frame')
        self.assertAlmostEqual(control['properties']['Left'],450,delta=15);self.assertAlmostEqual(control['properties']['Top'],2400,delta=15);self.done()

    def test_asset_flow_drop_inserts_before_sibling_and_solves(self):
        self.enable(True);self.select(['frame'])
        self.page.locator('[data-auto-property="LayoutMode"]').select_option('1');self.page.wait_for_timeout(100)
        source=self.asset('Label');source.hover()
        target=self.page.locator('.mdi-active [data-control-id="frame"]>.vb-frame-client').bounding_box()
        zoom=self.page.evaluate('vb6Studio.designer.zoom')
        # A real layout-padding handle intentionally covers this insertion point.
        # Use the physical native drag gesture so it lands on that overlay, not
        # locator hit-target actionability which requires its underlying client.
        origin=source.bounding_box();self.page.mouse.down()
        self.page.mouse.move(origin['x']+origin['width']/2+10,origin['y']+30,steps=3)
        self.page.mouse.move(target['x']+zoom,target['y']+2*zoom,steps=10)
        self.page.mouse.move(target['x']+zoom+.1,target['y']+2*zoom)
        self.page.mouse.up();self.page.wait_for_timeout(80)
        c=self.inserted();self.assertEqual(c['parent'],'Frame1')
        self.assertEqual(c['properties']['Left'],0)
        self.assertGreater(self.props('button')['Left'],0)
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.filter(c=>c.parent==="Frame1")[0].id'),c['id']);self.done()

    def test_pointer_grip_drop_and_escape_are_transactional(self):
        self.enable();self.asset('Label');grip=self.page.get_by_role('button',name='Place Label on designer',exact=True)
        r=grip.bounding_box();target=self.page.locator('.mdi-active .vb-form-content').bounding_box()
        before=self.snapshot();self.page.mouse.move(r['x']+10,r['y']+20);self.page.mouse.down();self.page.mouse.move(target['x']+20,target['y']+target['height']-40,steps=10)
        expect(self.page.locator('.figma-asset-ghost')).to_be_visible();self.page.screenshot(path=str(base.REPORT/'asset-drop-preview.png'));self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertEqual(self.snapshot(),before);self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.ui.assets.active'))
        r=grip.bounding_box();self.page.mouse.move(r['x']+10,r['y']+20);self.page.mouse.down();self.page.mouse.move(target['x']+20,target['y']+target['height']-40,steps=10);self.page.mouse.up()
        self.assertEqual(self.inserted()['type'],'Label');self.done()

    def test_keyboard_asset_placement_and_stale_drop_rejection(self):
        self.enable();self.asset('CommandButton');grip=self.page.get_by_role('button',name='Place CommandButton on designer',exact=True)
        grip.press('Enter');self.page.keyboard.press('ArrowDown');self.page.keyboard.press('Enter')
        self.assertEqual(self.inserted()['type'],'CommandButton')
        self.asset('TextBox');grip=self.page.get_by_role('button',name='Place TextBox on designer',exact=True);grip.press('Enter')
        self.page.evaluate('vb6Studio.designer.locked=true;vb6Studio.figmaMode.sync()');before=self.snapshot();self.page.keyboard.press('Enter')
        self.assertEqual(self.snapshot(),before);self.page.evaluate('vb6Studio.designer.locked=false');self.done()

    def test_external_payload_and_runtime_guard_do_not_insert_controls(self):
        self.enable();before=self.snapshot()
        self.page.locator('.mdi-active .vb-form-content').evaluate('n=>{const d=new DataTransfer();d.setData("application/x-vb6-studio-asset","CommandButton");n.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:d}));}')
        self.assertEqual(self.snapshot(),before)
        self.page.evaluate('vb6Studio.runState="running";vb6Studio.figmaMode.sync()');self.asset('Label')
        expect(self.page.get_by_role('button',name='Place Label on designer',exact=True)).to_be_disabled();self.page.evaluate('vb6Studio.runState="design"');self.done()

    @unittest.skipUnless(base.ENGINE=='chromium','Physical touch stream uses Chromium CDP; other engines qualify native and mouse-grip paths')
    def test_touch_grip_can_drop_without_native_html_drag_api(self):
        self.enable();self.asset('TextBox');grip=self.page.get_by_role('button',name='Place TextBox on designer',exact=True)
        r=grip.bounding_box();target=self.page.locator('.mdi-active .vb-form-content').bounding_box()
        cdp=self.context.new_cdp_session(self.page);cdp.send('Emulation.setTouchEmulationEnabled',{'enabled':True})
        x,y=r['x']+r['width']/2,r['y']+20;tx,ty=target['x']+20,target['y']+target['height']-40
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for i in range(1,11):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+(tx-x)*i/10,'y':y+(ty-y)*i/10}]})
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        self.assertEqual(self.inserted()['type'],'TextBox');self.done()


    def test_alt_placement_ignores_flow_and_timer_remains_form_owned(self):
        self.enable(True);self.select(['frame']);self.page.locator('[data-auto-property="LayoutMode"]').select_option('1')
        source=self.asset('TextBox');grip=self.page.get_by_role('button',name='Place TextBox on designer',exact=True)
        r=grip.bounding_box();target=self.page.locator('.mdi-active [data-control-id="frame"]>.vb-frame-client').bounding_box()
        self.page.mouse.move(r['x']+12,r['y']+20);self.page.mouse.down();self.page.keyboard.down('Alt')
        self.page.mouse.move(target['x']+40,target['y']+120,steps=8);self.page.mouse.up();self.page.keyboard.up('Alt')
        c=self.inserted();self.assertEqual(c['parent'],'Frame1');self.assertEqual(c['properties']['LayoutIgnore'],-1)
        self.assertGreater(c['properties']['Top'],0)
        self.drop_asset('Timer','.mdi-active [data-control-id="frame"]>.vb-frame-client',900,2700)
        c=self.inserted();self.assertEqual(c['type'],'Timer');self.assertIsNone(c['parent']);self.assertIsNone(c['nativeParentId']);self.done()

    def test_pointer_edge_pan_is_view_only_and_stops_at_cancel(self):
        self.enable();self.asset('Label');grip=self.page.get_by_role('button',name='Place Label on designer',exact=True)
        r=grip.bounding_box();canvas=self.page.locator('.designer-scroll[data-figma-viewport]').bounding_box()
        before=self.snapshot();state=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        self.page.mouse.move(r['x']+12,r['y']+20);self.page.mouse.down()
        self.page.mouse.move(canvas['x']+canvas['width']-8,canvas['y']+canvas['height']/2,steps=8)
        self.page.wait_for_function('x=>vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state.x<x-20',arg=state['x'])
        self.assertEqual(self.snapshot(),before)
        self.page.keyboard.press('Escape');self.page.mouse.up()
        restored=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        self.assertAlmostEqual(restored['x'],state['x'],places=4);self.assertAlmostEqual(restored['y'],state['y'],places=4)
        self.page.wait_for_timeout(150);self.assertEqual(self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state'),restored);self.done()

    def test_asset_from_code_and_outside_or_revision_changed_drop(self):
        self.enable();self.page.get_by_role('button',name='Code',exact=True).click();self.asset('TextBox')
        grip=self.page.get_by_role('button',name='Place TextBox on designer',exact=True);grip.press('Enter')
        self.assertEqual(self.page.evaluate('vb6Studio.activeDoc.view'),'form');before=self.snapshot()
        self.page.evaluate('vb6Studio.activeModule.form.properties.Caption="Intervening edit"')
        changed=self.snapshot();self.page.keyboard.press('Enter');self.assertEqual(self.snapshot(),changed)
        self.asset('Label');grip=self.page.get_by_role('button',name='Place Label on designer',exact=True);r=grip.bounding_box()
        self.page.mouse.move(r['x']+12,r['y']+20);self.page.mouse.down();self.page.mouse.move(400,20,steps=6);self.page.mouse.up()
        self.assertEqual(self.snapshot(),changed);self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.ui.assets.active'));self.done()

    def test_code_context_cancel_and_project_switch_never_send(self):
        self.enable();self.page.get_by_role('button',name='Code',exact=True).click()
        self.page.evaluate('vb6Studio.editor.selectGlobal(0,15)')
        self.page.get_by_role('button',name='Agent',exact=True).click();self.page.get_by_label('Agent task',exact=True).fill('Keep original')
        self.page.get_by_role('button',name='Review selection for agent',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='Review authoring context',exact=True)
        text=dialog.get_by_label('Reviewed authoring context',exact=True).input_value()
        self.assertIn('Option Explicit',text);self.assertNotIn('Command1.Caption',text)
        dialog.get_by_role('button',name='Cancel',exact=True).click()
        expect(self.page.get_by_label('Agent task',exact=True)).to_have_value('Keep original')
        self.page.get_by_role('button',name='Review selection for agent',exact=True).click()
        self.page.evaluate('vb6Studio.codingAgents.conversations.create()')
        dialog.get_by_role('button',name='Append to draft',exact=True).click()
        error=self.page.get_by_role('dialog',name='Figma workspace',exact=True);expect(error).to_be_visible()
        self.assertFalse(self.page.evaluate('vb6Studio.codingAgents.agent.busy'));error.get_by_role('button',name='OK',exact=True).click();self.done()

    def test_other_tool_views_are_real_docked_and_preserve_application_style(self):
        self.enable();before=self.snapshot()
        style=self.page.evaluate('getComputedStyle(vb6Studio.designer.formView.controls[0].node).backgroundColor')
        for label,key in [('Object Browser','tool:object-browser'),('Resources','tool:resources'),('Data','tool:dataEnvironment')]:
            self.page.get_by_role('button',name='Tools',exact=True).click();self.page.get_by_role('menuitem',name=label,exact=True).click()
            self.assertTrue(self.page.evaluate('key=>!!vb6Studio.documents.tools.get(key)?.root.closest(".figma-host-content")',key))
            self.assertTrue(self.page.evaluate('vb6Studio.figmaMode.currentDesigner()!=null'))
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma",scheme:"dark"})')
        self.assertEqual(self.page.evaluate('getComputedStyle(vb6Studio.designer.formView.controls[0].node).backgroundColor'),style)
        self.assertEqual(self.snapshot(),before);self.done()

    def test_narrow_workspace_drawer_and_repeat_mode_lifecycle(self):
        self.enable();self.page.set_viewport_size({'width':700,'height':820})
        self.page.get_by_role('button',name='Agent',exact=True).click();expect(self.page.get_by_label('Agent task',exact=True)).to_be_visible()
        self.page.get_by_label('Agent task',exact=True).fill('Mobile draft')
        self.page.keyboard.press('Escape');expect(self.page.get_by_label('Agent task',exact=True)).not_to_be_visible()
        self.page.get_by_role('button',name='Agent',exact=True).click();expect(self.page.get_by_label('Agent task',exact=True)).to_have_value('Mobile draft')
        self.page.screenshot(path=str(base.REPORT/'agent-narrow.png'))
        for i in range(3):
            self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
            self.assertEqual(self.page.locator('.figma-hosted-tool').count(),0)
            self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma"})')
            self.page.get_by_role('button',name='Agent',exact=True).click()
            self.assertEqual(self.page.locator('.agent-panel').count(),1)
            expect(self.page.get_by_label('Agent task',exact=True)).to_have_value('Mobile draft')
        self.done()

    @unittest.skipIf(base.TRANSPORT=='memory','Opaque memory origin does not qualify local preference persistence')
    def test_service_dock_profiles_reload_without_authority_or_eager_connection(self):
        self.enable();self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.evaluate('vb6Studio.persist()')
        # Reload is another standalone IDE boot, not an eight-second widget
        # interaction. Keep the same real origin and require restored state.
        self.page.reload(wait_until='commit',timeout=base.IDE_STARTUP_TIMEOUT_MS)
        self.page.wait_for_function('globalThis.vb6Studio?.figmaMode?.enabled',polling=100,timeout=base.IDE_STARTUP_TIMEOUT_MS)
        self.page.get_by_role('button',name='Agent',exact=True).click()
        expect(self.page.get_by_label('Agent task',exact=True)).to_be_visible()
        self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled'))
        self.assertFalse(self.page.evaluate('vb6Studio.codingAgents.agent.busy'))
        self.assertEqual(self.page.evaluate('[...vb6Studio.docking.model.groups.values()].filter(g=>g.id==="figma-right").length'),1)
        self.done()


    def test_busy_agent_keeps_transport_and_permission_lease_while_rehosting(self):
        self.enable();self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.evaluate("""()=>{
          const api=vb6Studio.codingAgents;window.activeAgent=api.agent;
          window.fakeRun=activeAgent.run({provider:'openai',model:'test-model',prompt:'Synthetic local view lifecycle',mode:'readonly',
            transport:async(body,{receive,signal})=>{window.runSignal=signal;await new Promise((resolve,reject)=>{
              window.completeLocalRun=()=>{receive({type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Local fixture complete.'}]}],usage:{total_tokens:5}}});resolve();};
              signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
            });}}).then(result=>window.runResult=result);
        }""")
        self.page.wait_for_function('window.completeLocalRun&&vb6Studio.codingAgents.agent.busy')
        self.page.evaluate('window.originalLease=activeAgent.permissionSession')
        self.page.get_by_role('button',name='Hide Agent',exact=True).click()
        self.page.get_by_role('button',name='Agent',exact=True).click()
        self.page.get_by_role('button',name='Expand Agent to document',exact=True).click()
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"});vb6Studio.figmaMode.configure({mode:"figma"})')
        self.assertTrue(self.page.evaluate('activeAgent===vb6Studio.codingAgents.agent&&activeAgent.busy'))
        self.assertTrue(self.page.evaluate('originalLease===activeAgent.permissionSession&&!runSignal.aborted'))
        self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled'))
        self.page.evaluate('completeLocalRun()')
        self.page.evaluate('window.fakeRun')
        self.assertFalse(self.page.evaluate('activeAgent.busy'));self.done()


def load_tests(loader,standard,pattern):
    return unittest.TestSuite(ServicesAssets(name) for name in sorted(ServicesAssets.__dict__) if name.startswith('test_'))
if __name__=='__main__':unittest.main(verbosity=2)
