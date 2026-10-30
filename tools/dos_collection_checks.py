"""Canonical virtualized collections under independently owned DOS presenters."""
import json
from playwright.sync_api import expect


def run_collection_checks(browser, root, report, seed):
    page = browser.new_page(viewport={'width': 1840, 'height': 1000})
    errors, passed = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.set_content('<!doctype html><html><head><style>' +
                         (root / 'dist/vb6-controls.css').read_text() +
                         '</style><style>html,body{margin:0;width:100%;height:100%}</style></head><body></body></html>')
        page.add_script_tag(content=(root / 'dist/vb6-runtime.js').read_text())
        page.evaluate('''async seed=>{
          window.assertTUI=(value,message)=>{if(!value)throw Error(message);};
          window.collection=(host,type)=>host.forms[0].controls.find(c=>c.type===type);
          window.hosts=[];
          const types=['TreeView','ListView','MSFlexGrid','MSHFlexGrid','DataGrid'];
          const bounds=[[150,150,3900,2700],[4200,150,4200,2700],[150,3300,8250,3150],
            [150,6900,3900,2700],[4200,6900,4200,2700]];
          for(let index=0;index<3;index++){
            const p=structuredClone(seed);p.id='Collection'+index;p.name=p.id;
            const m=p.modules[0];m.code='Option Explicit\\nPrivate Sub DataGridTest_RowColChange()\\n  DataGridTest.Tag = CStr(DataGridTest.Row)\\nEnd Sub\\n';
            Object.assign(m.form.properties,{ClientWidth:8850,ClientHeight:10100,StartUpPosition:0,Left:0,Top:0});
            m.form.controls=types.map((type,i)=>{
              const c=structuredClone(seed.modules[0].form.controls.find(c=>c.type===type));
              const [Left,Top,Width,Height]=bounds[i];Object.assign(c.properties,{Left,Top,Width,Height});
              if(type==='TreeView')c.properties.Nodes=Array.from({length:400},(_,n)=>({Key:'n'+n,Text:'Node '+String(n).padStart(4,'0')}));
              else if(type==='ListView'){
                c.properties.ColumnHeaders=[{Key:'name',Text:'Name',Width:1440,Alignment:0},
                  {Key:'amount',Text:'Amount',Width:1440,Alignment:1},{Key:'status',Text:'Status',Width:1440,Alignment:2}];
                c.properties.ListItems=Array.from({length:400},(_,n)=>({Key:'i'+n,Text:'Item '+String(n).padStart(4,'0'),SubItems:[String(n),'OK']}));
              }else Object.assign(c.properties,{Rows:400,Cols:3,FixedRows:2,FixedCols:1,Locked:0,
                GridData:Array.from({length:400},(_,n)=>[n===0?'Header':n===1?'Units':'R'+String(n).padStart(4,'0'),String(n),'Value'])});
              return c;
            });
            const container=document.createElement('div');container.id='collection-'+index;
            container.style.cssText=`position:absolute;left:${index*605}px;top:0;width:600px;height:960px`;
            document.body.append(container);
            const presentation=index===0?{mode:'dos',profile:'turbo',cellHeight:16,formLayout:'authored'}:
              index===1?{mode:'dos',profile:'commander',cellWidth:9,cellHeight:18,formLayout:'authored'}:{mode:'classic'};
            hosts.push(await VB6Runtime.mountApplication(p,container,{presentation,persist:false,rendering:false,nativeWindows:false}));
          }
          window.a=hosts[0];window.b=hosts[1];window.c=hosts[2];
          window.initialProjects=hosts.map(host=>JSON.stringify(host.project));
        }''', seed)
        page.wait_for_function('a.tuiPresentation.snapshot().length>=5&&b.tuiPresentation.snapshot().length>=5')

        def check(name, expression):
            page.evaluate(expression)
            passed.append(name)

        check('canonical virtualized geometry shares each host cell pitch', '''()=>{
          for(const [host,pitch] of [[a,16],[b,18]])for(const control of host.forms[0].controls){
            assertTUI(control.collectionRowHeight===pitch,control.type+' canonical pitch differs');
            const row=control.node.querySelector('.vb-tree-row,.vb-lv-row,td[data-row]');
            const scale=control.node.getBoundingClientRect().height/control.node.offsetHeight;
            assertTUI(row&&Math.abs(row.getBoundingClientRect().height/scale-pitch)<.1,control.type+' physical row pitch differs: '+row?.getBoundingClientRect().height/scale);
            if(control.spacer)assertTUI(parseFloat(control.spacer.style.height)===400*pitch,control.type+' spacer differs');
            if(control.header)assertTUI(Math.abs(control.header.getBoundingClientRect().height/scale-pitch)<.1,'column header pitch differs');
            assertTUI(control.node.hasAttribute('data-tui-collection'),'collection lease missing');
          }
          for(const control of c.forms[0].controls){
            const native=control.type==='TreeView'||control.type==='ListView'?20:21;
            assertTUI(control.collectionRowHeight===native,'classic sibling pitch changed');
            assertTUI(!control.node.hasAttribute('data-tui-collection'),'classic sibling obtained a collection lease');
          }
          assertTUI(hosts.every((host,i)=>JSON.stringify(host.project)===initialProjects[i]),'presentation wrote project data');
        }''')

        # Move into the virtual collection, then use its actual keyboard handler.
        page.evaluate('''()=>{
          const tree=collection(a,'TreeView'),list=collection(a,'ListView');
          tree._selectedNode=tree.treeRows[150].node;list._selectedItem=list.listRows[150];
          for(const control of [tree,list])control.viewport.scrollTop=150*control.collectionRowHeight;
          tree.paintTreeRows();list.paintListRows();
        }''')
        tree_view = page.locator('#collection-0 [data-type=TreeView] .vb-virtual-viewport')
        tree_view.focus()
        tree_view.press('ArrowDown')
        list_view = page.locator('#collection-0 [data-type=ListView] .vb-virtual-viewport')
        list_view.focus()
        list_view.press('ArrowDown')
        page.wait_for_function("collection(a,'TreeView')._selectedNode.Text==='Node 0151'&&collection(a,'ListView')._selectedItem.Text==='Item 0151'")
        check('native collection navigation and virtual row identities remain authoritative', '''()=>{
          a.tuiPresentation.flush();
          for(const [type,label] of [['TreeView','Node 0151'],['ListView','Item 0151']]){
            const control=collection(a,type),row=control.node.querySelector('.selected');
            assertTUI(parseFloat(row.style.top)===151*16,type+' selected row is not on its logical pitch');
            const entry=a.tuiPresentation.controls.get(control.node);
            assertTUI(entry.buffer.toText().includes(label),type+' selected item not painted');
            assertTUI(control.node.querySelectorAll('.vb-tree-row,.vb-lv-row').length<30,type+' virtualization materialized the whole collection');
          }
          const list=collection(a,'ListView'),paint=a.tuiPresentation.controls.get(list.node).buffer.toText().split('\\n');
          assertTUI(paint[0].includes('Name')&&paint[0].includes('Amount'),'column headings lost at the projected origin');
          assertTUI(paint.some(row=>/Item 0151.*151.*OK/.test(row)),'aligned value was truncated by its neighboring column separator');
          assertTUI(getComputedStyle(list.node.querySelector('.vb-lv-row>div:nth-child(2)')).textAlign==='right','canonical column alignment ignored');
          assertTUI(getComputedStyle(list.node.querySelector('.vb-lv-row>div:nth-child(3)')).textAlign==='center','canonical center alignment ignored');
        }''')

        page.evaluate('''()=>{
          const grid=collection(a,'DataGrid');grid.props.Row=180;grid.props.Col=1;grid.ensureGridCellVisible();grid.paintGridRows();
        }''')
        grid_view = page.locator('#collection-0 [data-type=DataGrid] .vb-grid-scroll')
        grid_view.focus()
        grid_view.press('ArrowDown')
        page.wait_for_function("collection(a,'DataGrid').Tag==='181'")
        check('grid keyboard reveal, sticky headers and VB6 events use the same cell geometry', '''()=>{
          const grid=collection(a,'DataGrid');a.tuiPresentation.flush();
          assertTUI(grid.props.Row===181&&grid.props.Col===1,'canonical grid selection changed');
          const buffer=a.tuiPresentation.controls.get(grid.node).buffer,text=buffer.toText().split('\\n');
          assertTUI(text[0].includes('Header')&&text[1].includes('Units'),'scrolled rows overwrote sticky headers: '+text.slice(0,3));
          assertTUI(text.some(row=>row.includes('R0181')),'keyboard-selected grid row is not visible');
          assertTUI(grid.RowHeight(181)===315,'DOS display mutated authored VB row height');
        }''')

        check('live metric switches preserve logical scroll anchors and independent hosts', '''()=>{
          const before=a.forms[0].controls.map(control=>control.viewport.scrollTop/control.collectionRowHeight);
          a.setPresentation({mode:'dos',profile:'win31',cellWidth:10,cellHeight:24,formLayout:'authored'});a.tuiPresentation.flush();
          for(const [i,control] of a.forms[0].controls.entries()){
            assertTUI(control.collectionRowHeight===24,'new canonical cell pitch missing');
            assertTUI(Math.abs(control.viewport.scrollTop/24-before[i])<.07,'scroll anchor moved on metric switch');
          }
          assertTUI(b.forms[0].controls.every(control=>control.collectionRowHeight===18),'sibling metrics changed');
        }''')

        editor_cell = page.locator('#collection-0 [data-type=DataGrid] td[data-row="181"][data-col="1"]')
        editor_cell.dblclick()
        editor = page.locator('#collection-0 [data-type=DataGrid] td input')
        expect(editor).to_have_count(1)
        editor.fill('Edited through the original grid input')
        check('presentation switching retains the original active grid editor and staged text', '''()=>{
          const grid=collection(a,'DataGrid'),input=grid.gridEditor.input,value=input.value;
          window.collectionEditor=input;
          a.setPresentation({mode:'classic'});
          assertTUI(grid.collectionRowHeight===21,'native grid pitch did not restore');
          assertTUI(grid.gridEditor.input===input&&input.isConnected&&input.value===value,'switch committed or replaced the editor');
          a.setPresentation({mode:'dos',profile:'turbo',cellHeight:16,formLayout:'authored'});a.tuiPresentation.flush();
          assertTUI(grid.gridEditor.input===input&&input.value===value,'re-entering DOS replaced the editor');
          assertTUI(grid.collectionRowHeight===16,'active grid did not accept the DOS pitch');
        }''')
        editor.press('Enter')
        page.wait_for_function("collection(a,'DataGrid').TextMatrix(181,1)==='Edited through the original grid input'&&!collection(a,'DataGrid').gridEditor")
        passed.append('original grid commit updates the canonical cell once after presentation changes')

        check('classic restoration retires row/style leases while preserving a live sibling', '''()=>{
          a.setPresentation({mode:'classic'});
          for(const control of a.forms[0].controls){
            const native=control.type==='TreeView'||control.type==='ListView'?20:21;
            assertTUI(control.collectionRowHeight===native,'native metric not restored');
            assertTUI(!control.node.hasAttribute('data-tui-collection')&&!control.node.style.getPropertyValue('--tui-collection-row'),'metric style lease leaked');
          }
          assertTUI(document.querySelectorAll('[data-tui-collection-style]').length===1,'live sibling lost shared collection style');
          const renderer=b.tuiPresentation;b.dispose();
          assertTUI(renderer.disposed,'runtime presenter not disposed');
          assertTUI(!document.querySelector('[data-tui-collection-style]'),'last collection stylesheet lease leaked');
        }''')
        assert not errors, errors
        (report / 'collection-metrics.json').write_text(json.dumps({'passed': passed, 'errors': errors}, indent=2))
        return passed
    except Exception:
        page.screenshot(path=str(report / 'collection-metrics-failure.png'), full_page=True)
        (report / 'collection-metrics-failure.json').write_text(json.dumps({'passed': passed, 'errors': errors,
            'state': page.evaluate('''()=>({hosts:(window.hosts||[]).map(host=>({disposed:host.disposed,state:host.vm?.state,metrics:host.tuiPresentation?.metrics,
              controls:host.forms[0]?.controls.map(c=>({type:c.type,pitch:c.collectionRowHeight,scroll:c.viewport?.scrollTop,scrollX:c.viewport?.scrollLeft,geometry:{node:c.node.getBoundingClientRect().toJSON(),offsetWidth:c.node.offsetWidth,offsetHeight:c.node.offsetHeight,clientLeft:c.node.clientLeft,clientTop:c.node.clientTop,first:c.node.querySelector('.vb-lv-row>div')?.getBoundingClientRect().toJSON(),header:c.node.querySelector('.vb-lv-header>div')?.getBoundingClientRect().toJSON()},paint:host.tuiPresentation?.controls.get(c.node)?.buffer?.toText(),html:c.node.outerHTML.slice(0,2400)}))}))})''')}, indent=2))
        raise
    finally:
        page.evaluate('()=>{for(const host of window.hosts||[])host.dispose();}')
        page.close()
