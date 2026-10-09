export const UI_EXAMPLES=Object.freeze({
  calculator:{title:'Reactive estimate',source:`{@body const [seats, setSeats] = DIL.useState(8)}
{@body const monthly = seats * 29}
<box padding={3} border={true}>
<title>Team estimate</title>
<text>Drag the slider. The calculation stays local; no model request is made.</text>
<slider label="Seats" min={1} max={40} step={1} value={seats} onChange={v => setSeats(v)} />
<metric label="Monthly total" value={monthly} unit="USD" />
<button onClick={() => GenUI.issueNewTurn("Explain the estimate for " + seats + " seats at $" + monthly + " per month.")}>Queue a follow-up</button>
</box>`},
  controls:{title:'Real VB6 controls',source:`{@body const [name, setName] = DIL.useState("Ada")}
{@body const [enabled, setEnabled] = DIL.useState(true)}
<column gap={3} padding={3} border={true}>
<title>Existing VB6 control renderer</title>
<VB6TextBox label="Your name" value={name} onChange={value => setName(value)} />
<VB6CheckBox caption="Enable greeting" checked={enabled} onChange={value => setEnabled(value)} />
<VB6Label caption={enabled ? "Hello, " + name : "Greeting disabled"} />
<VB6Button caption="Copy greeting" disabled={!enabled} onClick={() => GenUI.copy("Hello, " + name)} />
</column>`},
  project:{title:'Bound project inventory',source:`# Project inventory
<text>Data below is bound from an inspected project snapshot.</text>
<metric label="Project" value={data.project.name} />
<table label="Modules" rows={data.project.documents} columns={[{key:"name",label:"Module"},{key:"kind",label:"Kind"},{key:"lines",label:"Lines"}]} pageSize={8} />
<chart label="Lines per module" data={data.project.documents} x="name" y="lines" kind="bar" />`},
  responsive:{title:'Responsive dashboard',source:`{@body const [seats,setSeats] = DIL.useState(8)}
<title>Responsive team estimate</title>
<caption>Resize this panel; input state stays local.</caption>
<grid columns={DIL.useBreakpoint("md") ? 2 : 1} gap={3}>
<box border padding={3}><slider label="Seats" min={1} max={40} value={seats} onChange={setSeats}/><metric label="Monthly total" value={seats*29} unit="USD" change="Local calculation"/></box>
<box border padding={3}><icon name="info" label="Information"/><text>Available width: {DIL.useViewport().width} CSS pixels.</text><button onClick={()=>GenUI.issueNewTurn("Explain the estimate for "+seats+" seats.")}>Review follow-up <icon name="arrow-right" inline/></button></box>
</grid>`},
  app:{title:'Isolated interactive app',source:`<AppBlock title="Counter app" app_block_id="counter"><h2>Isolated counter</h2><button id="increment">Count: 0</button><button id="followup">Ask agent</button><output id="delivery"></output><script>let count=0;document.querySelector('#increment').onclick=event=>{event.target.textContent='Count: '+(++count)};document.querySelector('#followup').onclick=async()=>{const output=document.querySelector('#delivery');output.textContent='Awaiting review';try{await GenUI.issueNewTurn('Explain counter '+count);output.textContent='Queued';}catch{output.textContent='Declined';}};</script></AppBlock>`},
  reviewed:{title:'Reviewed content and context',source:`{@body const [selection,setSelection] = DIL.useState("Current selection")}
<column gap={3} padding={3} border>
<title>Reviewed view context</title>
<input label="Selection" value={selection} onChange={setSelection}/>
<button onClick={()=>GenUI.updateContext({selection})}>Replace view context</button>
<button onClick={()=>GenUI.sendMessage([{type:"text",text:"Review this selected note."},{type:"resource",resource:{uri:"ui://vb6/selection.txt",mimeType:"text/plain",text:selection}}])}>Queue note attachment</button>
<caption>Context replaces this view's snapshot. Attached content is sent only after queue and provider confirmation.</caption>
</column>`},
  references:{title:'Inspected reference' ,source:'<title>Inspected project reference</title><Cite ref="preview-project" />'}
});
export const INTELLIGENT_UI_INSTRUCTIONS=`
Interactive UI is available as an optional presentation, not an authority grant. Call vb6.ui.catalog for the exact component catalog and inspected data bindings. Use vb6.ui.present({source,title,dataRefs:{alias:"exact previously inspected tool name"}}) for grounded interactive tool results; never invent inspected data or references. Updates require the returned ui.revision as expectedUIRevision. Small explanations may instead stream an explicit fenced block labelled vb6-ui (not ordinary JavaScript). Syntax: <slider value={seats} onChange={v => setSeats(v)} />, {@body const [seats,setSeats] = DIL.useState(8)}, {seats * 29}, {#if test}...{:else}...{/if}, {#each items as item,i (item.id)}...{/each}. Use literal component names and catalog properties. DIL.useViewport() provides container width and display height in CSS pixels; DIL.useBreakpoint("md") selects layouts at sm=640, md=768, lg=1024 and xl=1280. Use these hooks instead of window/document. icon names and image aspectRatio/objectFit must follow the catalog. Expressions are a bounded subset, not JavaScript: no host globals, import, fetch, eval, new, template strings or arbitrary statements. Use GenUI.issueNewTurn(text), sendMessage(MCPContentBlocks), copy(text), openUrl(url), callTool(name,args), updateContext(data) only in event callbacks. Structured view context replaces the previous context for that view and is included only in the next user-confirmed run; it does not queue or send a new prompt. Image/PDF attachments are preserved for compatible providers; unsupported formats are diagnosed. Call vb6.ui.catalog to discover explicitly registered reference providers before vb6.ui.resolveReference; exact-query approval is required and no provider is configured implicitly. IDE message/tool actions are reviewed and queued; context is reviewed and replaces its view snapshot. Nothing is automatically sent or executed. Project permissions and current revision checks still apply. Images and citations use host-resolved references; no URLs are fetched without a local action. Raw AppBlock execution requires an explicitly configured separate-origin sandbox and user approval. It never inherits project or tool permission. Provide useful explanatory text outside the UI fence as a fallback.`;
