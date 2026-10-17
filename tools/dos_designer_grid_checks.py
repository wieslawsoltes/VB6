"""Character-cell authoring through the real shared designer and undo service."""
import json
from playwright.sync_api import expect


def pointer_bounds(page, selector):
    # Selection overlays replace their handle nodes after a ResizeObserver frame.
    # Read the live rect in one browser turn instead of keeping a protocol node
    # between element resolution and bounding-box measurement (racy in WebKit).
    locator = page.locator(selector)
    expect(locator).to_be_visible()
    bounds = locator.evaluate('''node => {
      const r=node.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    }''')
    assert bounds['width'] > 0 and bounds['height'] > 0, bounds
    return bounds


def run_designer_grid_checks(browser, root, report):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1.25)
    errors, passed = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.set_content((root / 'dist/VB6-Studio-Web.html').read_text(), wait_until='load')
        page.wait_for_function('window.vb6Studio?.dosMode')
        page.evaluate('''async () => {
          const ide=vb6Studio,api=VB6StudioAPI,p=api.newProject('CellDesigner'),m=p.modules[0];
          m.bookmarks=[];
          Object.assign(m.form.properties,{ClientWidth:9000,ClientHeight:6000});
          Object.assign(p.settings,{gridSize:120,showGrid:true,snapToGrid:true});
          const c=api.createControl('CommandButton','MoveButton',480,480);
          Object.assign(c.properties,{Caption:'&Move me',Width:1440,Height:480});m.form.controls=[c];
          ide.setRenderingPolicy({backend:'html'});ide.loadProject(p);ide.designer.select([c.id]);
          window.gridControl=()=>vb6Studio.activeModule.form.controls.find(c=>c.name==='MoveButton');
          window.originalGridProject=JSON.stringify(ide.project);
          await ide.dosMode.configure({mode:'dos',profile:'turbo',cellWidth:8,cellHeight:16,formLayout:'authored',designerGrid:'cells'});
        }''')
        page.wait_for_function('vb6Studio.designer.grid.grid===8&&vb6Studio.designer.grid.gridY===16')
        page.wait_for_function("vb6Studio.dosMode.sessions.get(document).controls.get(vb6Studio.designer.formView.node)?.buffer?.glyphs.includes('·'.codePointAt(0))")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===originalGridProject')
        passed.append('presentation applies rectangular grid without a model edit')

        page.locator('.designer-scroll:visible').focus()
        page.keyboard.press('ArrowRight')
        page.keyboard.press('ArrowDown')
        page.keyboard.press('Shift+ArrowDown')
        assert page.evaluate('({left:gridControl().properties.Left,top:gridControl().properties.Top,height:gridControl().properties.Height})') == {'left': 600, 'top': 720, 'height': 720}
        for _ in range(3):
            page.evaluate("vb6Studio.command('undo')")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===originalGridProject')
        passed.append('keyboard move and resize use both cell axes and canonical undo')

        page.wait_for_function('vb6Studio.designer.grid.gridY===16')
        bounds = pointer_bounds(page, '[data-control="MoveButton"]')
        x, y = bounds['x'] + bounds['width'] / 2, bounds['y'] + bounds['height'] / 2
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 16, y + 32, steps=4); page.mouse.up()
        assert page.evaluate('({left:gridControl().properties.Left,top:gridControl().properties.Top})') == {'left': 720, 'top': 960}
        page.evaluate("vb6Studio.command('undo')")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===originalGridProject')
        passed.append('pointer drag follows the same cell lattice and undo transaction')

        page.wait_for_function('vb6Studio.designer.grid.gridY===16')
        page.evaluate("vb6Studio.designer.setTool('TextBox')")
        origin = page.evaluate('''() => {const r=vb6Studio.designer.formView.content.getBoundingClientRect();return {x:r.left,y:r.top};}''')
        page.mouse.move(origin['x'] + 200, origin['y'] + 160)
        page.mouse.down(); page.mouse.move(origin['x'] + 246, origin['y'] + 218, steps=4); page.mouse.up()
        drawn = page.evaluate('''() => {const c=vb6Studio.activeModule.form.controls.find(c=>c.type==='TextBox');return c&&Object.fromEntries(['Left','Top','Width','Height'].map(k=>[k,c.properties[k]]));}''')
        assert drawn == {'Left': 3000, 'Top': 2400, 'Width': 720, 'Height': 960}, drawn
        page.evaluate("vb6Studio.command('undo')")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===originalGridProject')
        passed.append('toolbox drawing quantizes position and extent independently')

        page.evaluate('''() => {vb6Studio.designer.select([gridControl().id]);}''')
        page.wait_for_function('vb6Studio.designer.grid.gridY===16')
        handle = pointer_bounds(page, '.selection-outline .selection-handle.se')
        x, y = handle['x'] + handle['width'] / 2, handle['y'] + handle['height'] / 2
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 8, y + 16, steps=4); page.mouse.up()
        assert page.evaluate('({width:gridControl().properties.Width,height:gridControl().properties.Height})') == {'width': 1560, 'height': 720}
        page.evaluate("vb6Studio.command('undo')")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===originalGridProject')
        passed.append('selection handles resize on the same grid')

        page.evaluate('''async () => {
          const ide=vb6Studio,p=structuredClone(ide.project);
          Object.assign(p.settings,{anchoring:true,autoLayoutGuides:false});
          Object.assign(p.modules[0].form.controls[0].properties,{Left:495,Top:510,Width:1455,Height:495});
          ide.loadProject(p);ide.designer.select([gridControl().id]);
          window.layoutGridProject=JSON.stringify(ide.project);
          await ide.dosMode.configure({mode:'dos',formLayout:'authored',designerGrid:'cells',cellWidth:8,cellHeight:16});
        }''')
        page.wait_for_function('vb6Studio.designer.grid.gridY===16')
        bounds = pointer_bounds(page, '[data-control="MoveButton"]')
        x, y = bounds['x'] + bounds['width'] / 2, bounds['y'] + bounds['height'] / 2
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 9, y + 9, steps=4); page.mouse.up()
        assert page.evaluate('({left:gridControl().properties.Left,top:gridControl().properties.Top})') == {'left': 600, 'top': 720}
        page.evaluate("vb6Studio.command('undo')")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===layoutGridProject')
        page.wait_for_function('vb6Studio.designer.grid.gridY===16')
        for edge, expected_width, expected_height in [('se', 1560, 720), ('e', 1560, 495)]:
            handle = pointer_bounds(page, '.selection-outline .selection-handle.' + edge)
            x, y = handle['x'] + handle['width'] / 2, handle['y'] + handle['height'] / 2
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 9, y + 9, steps=4); page.mouse.up()
            assert page.evaluate('({left:gridControl().properties.Left,top:gridControl().properties.Top,width:gridControl().properties.Width,height:gridControl().properties.Height})') == {'left': 495, 'top': 510, 'width': expected_width, 'height': expected_height}
            page.evaluate("vb6Studio.command('undo')")
            assert page.evaluate('JSON.stringify(vb6Studio.project)===layoutGridProject')
            page.wait_for_function('vb6Studio.designer.grid.gridY===16')
        passed.append('auto-layout free gestures share axis snapping and preserve stationary resize edges')

        page.evaluate('''async () => {
          const d=vb6Studio.designer;d.select([gridControl().id]);
          vb6Studio.setProperty('Caption','abcdefghijklmnopqrstuvwxy');vb6Studio.setProperty('Height',240);
          window.beforeReadable=JSON.stringify(vb6Studio.project);
          await vb6Studio.dosMode.configure({formLayout:'readable',cellWidth:9,cellHeight:18});
        }''')
        page.wait_for_function('''() => {
          const d=vb6Studio.designer,[x,y]=d.formView.node.style.scale.split(' ').map(Number);
          return x>0&&y>0&&Math.abs(d.grid.grid-9/x)<1e-9&&Math.abs(d.grid.gridY-18/y)<1e-9;
        }''')
        metrics = page.evaluate('''() => {
          const d=vb6Studio.designer,[x,y]=d.formView.node.style.scale.split(' ').map(Number);
          return {column:d.grid.grid,row:d.grid.gridY,expectedColumn:9/x,expectedRow:18/y};
        }''')
        assert abs(metrics['column'] - metrics['expectedColumn']) < 1e-9, metrics
        assert abs(metrics['row'] - metrics['expectedRow']) < 1e-9, metrics
        assert page.evaluate('JSON.stringify(vb6Studio.project)===beforeReadable')
        page.evaluate('vb6Studio.designer.setZoom(0.75)')
        page.wait_for_function('''expected => {
          const d=vb6Studio.designer;
          return Math.abs(d.grid.grid-expected.column)<1e-9&&Math.abs(d.grid.gridY-expected.row)<1e-9;
        }''', arg=metrics)
        assert abs(page.evaluate('vb6Studio.designer.grid.gridY') - metrics['row']) < 1e-9
        page.locator('.designer-scroll:visible').focus()
        before = page.evaluate('gridControl().properties.Top')
        for _ in range(3):
            page.keyboard.press('ArrowDown')
        expected = round((round(before / (metrics['row'] * 15)) + 3) * metrics['row'] * 15)
        assert page.evaluate('gridControl().properties.Top') == expected
        for _ in range(3):
            page.evaluate("vb6Studio.command('undo')")
        assert page.evaluate('JSON.stringify(vb6Studio.project)===beforeReadable')
        passed.append('readable scaling and designer zoom preserve local pitch and integer twips')
        page.screenshot(path=str(report / 'designer-cell-grid.png'))

        page.evaluate('void vb6Studio.dosMode.options()')
        page.get_by_label('DOS designer grid', exact=True).select_option('project')
        page.get_by_role('button', name='Cancel', exact=True).click()
        assert page.evaluate("vb6Studio.dosMode.settings.designerGrid==='cells'")
        page.evaluate("vb6Studio.dosMode.configure({designerGrid:'project'})")
        page.wait_for_function('vb6Studio.designer.grid.grid===8&&vb6Studio.designer.grid.gridY===8')
        assert page.evaluate('JSON.stringify(vb6Studio.project)===beforeReadable')
        page.evaluate("vb6Studio.dosMode.configure({designerGrid:'cells'})")
        page.wait_for_function('''expected => {
          const d=vb6Studio.designer;
          return Math.abs(d.grid.grid-expected.column)<1e-9&&Math.abs(d.grid.gridY-expected.row)<1e-9;
        }''', arg=metrics)
        page.evaluate("vb6Studio.dosMode.configure({mode:'classic'})")
        page.wait_for_function('vb6Studio.designer.grid.grid===8&&vb6Studio.designer.grid.gridY===8')
        assert page.evaluate('JSON.stringify(vb6Studio.project)===beforeReadable')
        passed.append('staged options and disposal restore the project grid without model changes')
        assert not errors, errors
        result = {'passed': passed, 'errors': errors, 'scope': 'Actual shared designer input and history; offline production bundle.'}
        (report / 'designer-grid.json').write_text(json.dumps(result, indent=2))
        return result
    except Exception:
        page.screenshot(path=str(report / 'designer-grid-failure.png'))
        raise
    finally:
        page.close()
