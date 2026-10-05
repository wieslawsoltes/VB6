from pathlib import Path
r=Path('.')
p=r/'src/mcp/agent-permissions.js';s=p.read_text();s=s.replace("project: 'Create/import/replace projects and change project metadata'", "project: 'Create/import/replace projects, change metadata and undo/redo project history'")
s=s.replace("  const part = name.split('.')[1];", "  // Classify effects, not just the UI surface that exposes an operation.\n  if (name === 'vb6.editor.edit') return 'code';\n  if (name === 'vb6.history.apply') return 'project';\n  if (name === 'vb6.runtime.capture') return 'files';\n  const part = name.split('.')[1];")
s=s.replace('revoke(abort = true)', 'revoke()').replace('if (abort) this.controller?.abort();', 'this.controller?.abort();')
p.write_text(s)
p=r/'src/mcp/ide-adapter.js';s=p.read_text().replace('isRecord, awaitAbort}', 'isRecord, awaitAbort, validateArguments}')
s=s.replace('let revision = 1, eventSequence = 1, enabled = false, changeTimer;', 'let revision = 1, eventSequence = 1, authorityEpoch = 1, enabled = false, changeTimer;\n  let authorityLifetime = new AbortController(), sharingLifetime = new AbortController();\n  function invalidateAuthority() { authorityEpoch++; authorityLifetime.abort(); authorityLifetime = new AbortController(); permissions.revoke(); }')
s=s.replace('permissions.revoke(false);', 'invalidateAuthority();')
s=s.replace('get enabled() { return enabled; },', 'get enabled() { return enabled; },\n    get authorityEpoch() { return authorityEpoch; }, get authoritySignal() { return authorityLifetime.signal; },')
s=s.replace('setEnabled(value) { permissions.revoke(); enabled = !!value; changed(); },', 'setEnabled(value) { sharingLifetime.abort(); sharingLifetime = new AbortController(); invalidateAuthority(); enabled = !!value; changed(); },')
s=s.replace('dispose() { permissions.dispose(); enabled = false;', 'dispose() { sharingLifetime.abort(); authorityLifetime.abort(); permissions.dispose(); enabled = false;')
s=s.replace("    adapter.assertEnabled(); checkAbort(context.signal); checkRevision(args.expectedRevision);\n", "    context.signal = AbortSignal.any([context.signal, authorityLifetime.signal].filter(Boolean));\n    adapter.assertEnabled(); checkAbort(context.signal); checkRevision(args.expectedRevision);\n",1)
s=s.replace('approve({name, arguments: args, projectName:', 'approve({name, arguments: clone(args), projectName:')
a="""    adapter.tools.push({name, description, inputSchema: objectSchema(properties, required), annotations: {readOnlyHint: !write, destructiveHint: destructive, idempotentHint: !write, openWorldHint: open}, execute: async (args, context) => {
      adapter.assertEnabled(); checkAbort(context.signal);
      try { const result = await awaitAbort(execute(args, context), context.signal); try { onActivity({direction: 'in', method: name}); } catch {} return result; }
"""
b="""    const inputSchema = objectSchema(properties, required);
    adapter.tools.push({name, description, inputSchema, annotations: {readOnlyHint: !write, destructiveHint: destructive, idempotentHint: !write, openWorldHint: open}, execute: async (args, context = {}) => {
      adapter.assertEnabled();
      validateArguments(args, inputSchema);
      // Isolate caller/consent objects and keep the transport request distinct from
      // delegated authority. A successful project replacement revokes old authority
      // without converting its already committed result into a cancelled response.
      const requestSignal = AbortSignal.any([context.signal, sharingLifetime.signal].filter(Boolean));
      checkAbort(requestSignal);
      const requestContext = {...context, signal: requestSignal}, snapshot = clone(args);
      try { const result = await awaitAbort(execute(snapshot, requestContext), requestSignal); try { onActivity({direction: 'in', method: name}); } catch {} return result; }
"""
assert a in s;s=s.replace(a,b)
s=s.replace("    await ide.command(args.command==='continue'?'run':args.command); return {revision, runState: ide.runState};", "    const state = ide.runState, paused = state === 'paused', action = args.command === 'run' ? 'continue' : args.command;\n    if (action !== 'pause' && !paused) throw new McpError(-32000, 'Pause before continuing or stepping.');\n    if (action === 'pause' && paused) return {revision, runState: state};\n    changed(); await ide.command(action === 'continue' ? 'run' : action); return {revision, runState: ide.runState};")
s=s.replace("    const cancel = () => ide.sendRuntime('cancelEvaluation');", "    const frame = ide.runtimeFrame, epoch = authorityEpoch;\n    // Reserve the revision before awaiting the sandbox: competing same-revision\n    // mutations must not run while an explicit evaluation is in flight.\n    changed();\n    const cancel = () => { if (frame === ide.runtimeFrame) ide.sendRuntime('cancelEvaluation'); };")
s=s.replace("),ctx.signal); changed(); return {revision, result};", "),ctx.signal); checkAbort(ctx.signal); if (frame !== ide.runtimeFrame || epoch !== authorityEpoch) throw new McpError(-32002, 'Runtime or workspace was replaced during evaluation.'); changed(); return {revision, result};")
p.write_text(s)
p=r/'src/mcp/studio.js';s=p.read_text()
s=s.replace('        let abort;\n        try {\n          const allow = await modal', '        let abort; const epoch = this.api.adapter.authorityEpoch;\n        try {\n          const allow = await modal',1)
s=s.replace('          checkAbort(signal); if (allow) await this.api.setSharing(true);', "          checkAbort(signal); if (allow) {\n            if (epoch !== this.api.adapter.authorityEpoch) throw new Error('Project or sharing changed. Review the current project before sharing.');\n            await this.api.setSharing(true);\n          }")
a="""        const projectId=this.api.adapter.snapshot().id;
        const accepted=await modal('Authorize coding agents?',{content:el('p',{},'Allow all paired clients to use '+selected.join(', ')+' for '+duration+' minutes in the current project? Execution scopes can run project code and retain its side effects. Only authorize clients you trust.'),buttons:[{label:'Cancel',value:false,primary:true},{label:'Authorize session',value:true}]});
        checkAbort(signal);if(!accepted)return;
        if(projectId!==this.api.adapter.snapshot().id||!this.api.adapter.enabled)throw new Error('Project or sharing changed.');
        this.api.adapter.permissions.allow(projectId,selected,duration);refresh();return {authorized:selected,minutes:duration};
"""
b="""        const projectId=this.api.adapter.snapshot().id, epoch=this.api.adapter.authorityEpoch;
        const lifetime=AbortSignal.any([signal,this.api.adapter.authoritySignal]); let abort;
        try {
          const accepted=await modal('Authorize coding agents?',{content:el('p',{},'Allow all paired clients to use '+selected.join(', ')+' for '+duration+' minutes in the current project? Execution scopes can run project code and retain its side effects. Only authorize clients you trust.'),buttons:[{label:'Cancel',value:false,primary:true},{label:'Authorize session',value:true}],
            onReady:({finish})=>{abort=()=>finish(false);lifetime.addEventListener('abort',abort,{once:true});if(lifetime.aborted)abort();}});
          checkAbort(lifetime);if(!accepted)return;
          if(epoch!==this.api.adapter.authorityEpoch||projectId!==this.api.adapter.snapshot().id||!this.api.adapter.enabled)throw new Error('Project or sharing changed.');
          this.api.adapter.permissions.allow(projectId,selected,duration);refresh();return {authorized:selected,minutes:duration};
        } finally {if(abort)lifetime.removeEventListener('abort',abort);}
"""
assert a in s;s=s.replace(a,b);p.write_text(s)
p=r/'src/runtime/agent-control.js';s=p.read_text().replace("    if(host.dialogs.length)throw new Error('Respond to the active application dialog first.');", "    if(host.dialogs.length)throw new Error('Respond to the active application dialog first.');\n    if(args.action!=='indexedGet'&&!['running','idle'].includes(host.vm.state))throw new Error('Resume the application or use typed debugger operations while paused.');")
s=s.replace("if(!METHODS.includes(args.method))throw new Error('Unsupported control method.');", "if(!METHODS.includes(args.method)||typeof control[args.method]!=='function')throw new Error('Unsupported control method.');").replace("if(!INDEXED.includes(args.method)||list.some", "if(!INDEXED.includes(args.method)||typeof control[args.method]!=='function'||list.some");p.write_text(s)
p=r/'tests/mcp-agent.test.mjs';s=p.read_text().replace('grant replacement aborts the old grant, while project replacement only clears authority','grant replacement and revocation both abort old authority').replace('p.revoke(false);assert.equal(second.aborted,false)','p.revoke();assert.equal(second.aborted,true)')
s+=r'''
test('agent: workspace delegation cannot edit source, undo projects or capture virtual files', async t => {
  let approvals=0;const f=fixture(t,{approve:async()=>{approvals++;return false;}});
  f.adapter.permissions.allow(f.ide.project.id,['workspace'],1);
  for(const [name,args] of [['editor.edit',{module:'Form1',command:'insert',text:'unapproved'}],['history.apply',{direction:'undo'}],['runtime.capture',{}]])
    await assert.rejects(f.write(name,args),/declined/);
  assert.equal(approvals,3);
  const scopes=new Map((await f.call('agent.capabilities')).tools.map(t=>[t.name,t.scope]));
  assert.equal(scopes.get('vb6.editor.edit'),'code');assert.equal(scopes.get('vb6.history.apply'),'project');assert.equal(scopes.get('vb6.runtime.capture'),'files');
});
test('agent: caller and approval mutations cannot alter approved argument snapshots', async t => {
  let release;const f=fixture(t,{approve:async request=>{request.arguments.code='changed by callback';return new Promise(r=>release=r);}});
  const args={module:'Form1',code:'Option Explicit\n',expectedRevision:f.adapter.revision};
  const pending=f.adapter.tools.find(t=>t.name==='vb6.module.write').execute(args);
  while(!release)await Promise.resolve();args.code='changed by caller';release(true);await pending;
  assert.equal(f.ide.project.modules[0].code,'Option Explicit\n');
});
test('agent: original descriptors validate direct calls exactly like the wire', async t => {
  const f=fixture(t),write=f.adapter.tools.find(t=>t.name==='vb6.module.write');
  await assert.rejects(write.execute({module:'Form1',code:42,expectedRevision:f.adapter.revision}),/expected string/);
  await assert.rejects(write.execute({module:'Form1',code:'',expectedRevision:f.adapter.revision,evil:true}),/unexpected evil/);
  assert.equal(f.ide.history.undoStack.length,0);
});
test('agent: replacing even the same project ID cancels pending authorization', async t => {
  let release;const f=fixture(t,{approve:()=>new Promise(r=>release=r)});
  const epoch=f.adapter.authorityEpoch,signal=f.adapter.authoritySignal;
  const pending=f.adapter.tools.find(t=>t.name==='vb6.module.write').execute({module:'Form1',code:'not allowed',expectedRevision:f.adapter.revision});
  while(!release)await Promise.resolve();const before=clone(f.ide.project);f.ide.loadProject(before);
  await assert.rejects(pending,/cancel/i);release(true);await new Promise(r=>setTimeout(r,1));
  assert.equal(signal.aborted,true);assert.ok(f.adapter.authorityEpoch>epoch);assert.deepEqual(f.ide.project,before);
});
test('agent: disable and reenable cannot revive a direct pending approval or wait', async t => {
  let release;const f=fixture(t,{approve:()=>new Promise(r=>release=r)});
  const write=f.adapter.tools.find(t=>t.name==='vb6.module.write').execute({module:'Form1',code:'stale',expectedRevision:f.adapter.revision});
  const wait=f.adapter.tools.find(t=>t.name==='vb6.agent.wait').execute({afterRevision:f.adapter.revision,timeoutMs:30000});
  const done=Promise.all([assert.rejects(write,/cancel/i),assert.rejects(wait,/cancel/i)]);
  while(!release)await Promise.resolve();f.adapter.setEnabled(false);f.adapter.setEnabled(true);await done;release(true);
  await new Promise(r=>setTimeout(r,1));assert.notEqual(f.ide.project.modules[0].code,'stale');
});
test('agent: a delegated replacement succeeds while revoking the previous workspace authority', async t => {
  const f=fixture(t);f.adapter.permissions.allow(f.ide.project.id,['project'],1);const grant=f.adapter.permissions.signal,authority=f.adapter.authoritySignal;
  const result=await f.write('project.new',{name:'Replacement'});assert.equal(result.name,'Replacement');
  assert.equal(grant.aborted,true);assert.equal(authority.aborted,true);assert.equal(f.adapter.permissions.grant,null);
});
test('agent: workspace replacement cancels an already approved sandbox evaluation', async t => {
  const f=fixture(t);f.ide.runState='paused';f.ide.runtimeFrame={};f.ide.debuggerWindows={pauseId:3,frameIndex:0};f.ide.stack=[{index:0}];
  let release,cancelled=0;f.ide.requestRuntime=()=>new Promise(r=>release=r);f.ide.sendRuntime=cmd=>{if(cmd==='cancelEvaluation')cancelled++;};
  const pending=f.write('debug.evaluate',{expression:'Slow()'});while(!release)await new Promise(r=>setTimeout(r,1));
  f.ide.loadProject(clone(f.ide.project));await assert.rejects(pending,/cancel/i);assert.equal(cancelled,1);release({value:'stale'});
});
test('agent: same-revision evaluation and breakpoint writes cannot both execute', async t => {
  const f=fixture(t);await f.client.connect();f.ide.runState='paused';f.ide.runtimeFrame={};f.ide.debuggerWindows={pauseId:3,frameIndex:0};f.ide.stack=[{index:0}];
  f.adapter.permissions.allow(f.ide.project.id,['debugger'],1);let release;f.ide.requestRuntime=()=>new Promise(r=>release=r);
  const revision=f.adapter.revision,evaluation=f.call('debug.evaluate',{expression:'Slow()',expectedRevision:revision});
  while(!release)await new Promise(r=>setTimeout(r,1));
  await assert.rejects(f.call('breakpoints.set',{breakpoints:[{module:'Form1',line:1}],expectedRevision:revision}),/changed/);
  assert.deepEqual(f.ide.breakpoints,[]);release({value:'ok'});await evaluation;
});
test('agent: debug step and continue reject running state rather than reporting false success', async t => {
  const f=fixture(t);f.ide.runState='running';
  for(const command of ['continue','run','stepInto','stepOver','stepOut'])await assert.rejects(f.write('debug.command',{command}),/Pause before/);
  assert.equal(f.ide.lastCommand,undefined);await f.write('debug.command',{command:'pause'});assert.equal(f.ide.lastCommand,'pause');
});
''';p.write_text(s)
p=r/'tests/mcp-runtime-agent.test.mjs';s=p.read_text()+'''

test('runtime agent: paused control mutations require debugger operations, while dialog replies remain available',()=>{
 const f=fixture(),id=f.agent.inspect().items[1].id;f.host.vm.state='paused';
 for(const args of [{action:'click'},{action:'focus'},{action:'set',property:'Text',value:'bad'},{action:'event',event:'Click'},{action:'call',method:'AddItem',arguments:['bad']},{action:'indexedSet',method:'TextMatrix',arguments:[1,1],value:'bad'}])assert.throws(()=>f.agent.interact({target:id,...args}),/Resume/);
 assert.equal(f.c.node.clicked,undefined);assert.equal(f.c.props.Text,undefined);
 assert.equal(f.agent.interact({target:id,action:'indexedGet',method:'TextMatrix',arguments:[1,1]}).value,'cell');
 f.host.dialogs.push(f.dialog);const dialog=f.agent.inspect().dialogs[0].id;f.agent.interact({target:dialog,action:'dialog',button:0,value:'allowed'});assert.equal(f.field.value,'allowed');
});
''';p.write_text(s)
p=r/'tools/mcp-browser-tests.py';s=p.read_text();anchor="        check(not page.evaluate('vb6Studio.mcp.bridge?.connected'))\n";assert s.count(anchor)==1
s=s.replace(anchor,anchor+'''        # Same-ID replacement cannot approve the wrong project or resurrect grants.
        tab(page,'Agent access')
        page.get_by_label('Enable MCP sharing',exact=True).check()
        page.get_by_role('dialog',name='Share this IDE through MCP?',exact=True).wait_for()
        page.evaluate('vb6Studio.loadProject(structuredClone(vb6Studio.project))')
        page.get_by_role('dialog').get_by_role('button',name='Enable sharing',exact=True).click();finished(page)
        check(not page.evaluate('vb6Studio.mcp.adapter.enabled'))
        tab(page,'Agent access')
        page.get_by_label('Enable MCP sharing',exact=True).check()
        page.get_by_role('dialog').get_by_role('button',name='Enable sharing',exact=True).click();finished(page)
        tab(page,'Agent permissions')
        page.get_by_label('Agent scope code',exact=True).check()
        page.get_by_role('button',name='Grant selected permissions',exact=True).click()
        page.get_by_role('dialog',name='Authorize coding agents?',exact=True).wait_for()
        page.evaluate('vb6Studio.loadProject(structuredClone(vb6Studio.project))')
        finished(page)
        check(page.get_by_role('dialog',name='Authorize coding agents?',exact=True).count()==0)
        check(not page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
        page.evaluate('vb6Studio.mcp.setSharing(false)')
''')
s=s.replace("def tab(page,name):page.locator('.mcp-panel').get_by_role('tab',name=name,exact=True).click()", "def tab(page,name):\n    page.evaluate(\"vb6Studio.command('mcpAgentAccess')\")\n    page.locator('.mcp-panel').get_by_role('tab',name=name,exact=True).click()")
p.write_text(s)
p=r/'docs/MCP-AGENTS.md';s=p.read_text().replace('Module source/identity, atomic edits, declarations, event stubs, bookmarks','Module source/identity, editor text edits, atomic edits, declarations, event stubs, bookmarks').replace('metadata, reference declarations and explorer','metadata, reference declarations, explorer and project undo/redo').replace('native RES and VB application settings','native RES, VB application settings and runtime capture').replace('Editor/document operations, history, docking, toolbars, appearance','Editor selection/views, documents, docking, toolbars, appearance')
s=s.replace('Agents cannot grant, extend or revoke local permissions, read credentials, click', 'Control mutations require a running/idle application; paused state changes use\nthe debugger tools. Replies to runtime dialogs opened by explicit evaluation\nremain available while paused.\n\nAgents cannot grant, extend or revoke local permissions, read credentials, click');p.write_text(s)
p=r/'docs/MCP.md';s=p.read_text().replace('state remain memory-only. An indicator shows enabled access and active scopes.', '''state remain memory-only. An indicator shows enabled access and active scopes.
Editor text edits require the **code** scope, whole-project undo/redo requires
**project**, and capturing runtime files into a project requires **files**.
The workspace scope alone cannot authorize these data changes.

Pending consent is bound to the current workspace instance, even when another
loaded project retains the same ID. Disabling/re-enabling sharing cannot revive
old requests. Explicit evaluations reserve their edit revision before awaiting
the sandbox, so concurrent same-revision mutations cannot both take effect.''');p.write_text(s)
