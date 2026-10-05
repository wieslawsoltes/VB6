import {AGENT_SCOPES, agentScope} from './agent-permissions.js';
import {el, download} from '../core/core.js';
import {modal, tabbedPages, icon} from '../ide/ui.js';
import {MCP_VERSION, McpError, checkAbort} from './protocol.js';
import {McpServer, bindMcpPort} from './server.js';
import {createIdeAdapter} from './ide-adapter.js';
import {BrowserBridge} from './bridge-client.js';
import {companionURL} from './companion-url.js';

const field = (label, input) => el('label', {class: 'mcp-field'}, el('span', {}, label), input);
const button = (text, action) => el('button', {type: 'button', onclick: action}, text);
const input = (label, attrs = {}) => el('input', {'aria-label': label, ...attrs});
const group = (legend, ...children) => el('fieldset', {}, el('legend', {}, legend), ...children);

let promptQueue = Promise.resolve();
function promptModal(title, options) {
  const job = promptQueue.catch(() => {}).then(() => modal(title, options)); promptQueue = job; return job;
}
function approvalQueue() {
  let tail = Promise.resolve();
  return (request, {signal} = {}) => {
    const job = tail.catch(() => {}).then(async () => {
      checkAbort(signal);
      const fullArguments = JSON.stringify(request.arguments || {}, null, 2), details = el('div', {}, el('pre', {class: 'mcp-approval-details'}, fullArguments.slice(0, 12000)), ...(fullArguments.length > 12000 ? [el('p', {}, 'Preview truncated. Download the complete arguments to review all changes before allowing this request.'), button('Download full request arguments', () => download('mcp-request.json', fullArguments, 'application/json'))] : []));
      let abort;
      try {
        return await promptModal('Allow MCP operation?', {width: 660,
          content: el('div', {class: 'mcp-approval'}, el('p', {}, 'An MCP client is requesting an operation. Allowing it can change data or execute code. Approval applies to this request only.'),
            el('p', {}, 'Operation: ' + request.name), el('p', {}, 'Peer: ' + (request.endpoint || request.peer || 'MCP client')), request.projectName ? el('p', {}, 'Project: ' + request.projectName) : '', details),
          buttons: [{label: 'Deny', value: false, primary: true}, {label: 'Allow once', value: true}],
          onReady: ({finish}) => { abort = () => finish(false); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); }});
      } finally { if (abort) signal?.removeEventListener('abort', abort); }
    }); tail = job; return job;
  };
}
/** Server-only MCP integration. External agents call the IDE; the IDE never calls external MCP tools. */
export function installMcp(ide, studioAPI, {approve = approvalQueue()} = {}) {
  if (ide.mcp) return ide.mcp;
  const listeners = new Set(), log = []; let sequence = 0, generation = 0, pendingBridge = null;
  const activity = entry => {
    log.push({time: new Date().toISOString(), direction:String(entry.direction||'').slice(0,16),method:String(entry.method||'').slice(0,200),...(entry.error?{error:String(entry.error).slice(0,2000)}:{})}); if (log.length > 300) log.splice(0, log.length - 300);
    for (const listener of listeners) { try { listener(); } catch {} }
  };
  const adapter = createIdeAdapter(ide, {approve, onActivity: activity}), server = new McpServer(adapter);
  const api = {adapter, server, log, bridge: null,
    closePanel() { ide.closeDocument('tool:mcp'); },
    clearActivity() { log.splice(0); for (const listener of listeners) { try { listener(); } catch {} } },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async setSharing(enabled) {
      adapter.setEnabled(enabled);
      if (!enabled) { server.revoke(); await api.detachBridge(); }
      activity({direction: 'local', method: enabled ? 'Agent access enabled' : 'Agent access disabled'});
    },
    async attachBridge(options) {
      if (!adapter.enabled) throw new McpError(-32001, 'Enable agent access before attaching the companion.');
      await api.detachBridge();
      const current = ++generation;
      if (!adapter.enabled) throw new McpError(-32001, 'Agent access was disabled.');
      const bridge = new BrowserBridge(server, {...options, onStatus: message => activity({direction: 'relay', method: message})});
      pendingBridge = bridge;
      try {
        await bridge.connect();
        if (current !== generation || !adapter.enabled) throw new McpError(-32800, 'Companion attachment was cancelled.');
        api.bridge = bridge; pendingBridge = null; activity({direction: 'local', method: 'Companion attached'}); return bridge;
      } catch (error) {
        if (pendingBridge === bridge) pendingBridge = null;
        await bridge.close(); throw error;
      }
    },
    async detachBridge() {
      generation++;
      const bridges = new Set([api.bridge, pendingBridge]); api.bridge = null; pendingBridge = null;
      // Detaching removes delegated authority as well as the paired external connection.
      adapter.permissions.revoke();
      for (const bridge of bridges) await bridge?.close();
      activity({direction: 'local', method: 'Companion detached'});
    },
    bindPort(port) { return bindMcpPort(port, server, {sessionKey: 'private-agent-port-' + (++sequence)}); }
  };
  const indicator = el('button', {type: 'button', class: 'mcp-agent-indicator', 'aria-label': 'MCP agent session', hidden: true, onclick: () => ide.openMcp?.()}, 'MCP agent access');
  ide.root.append(indicator);
  adapter.onChange(() => {
    const grant = adapter.permissions.snapshot(ide.project.id);
    indicator.hidden = !adapter.enabled;
    indicator.textContent = grant.active ? 'MCP agent: ' + grant.scopes.join(', ') : 'MCP: read access / approve writes';
  });
  ide.mcp = api;
  studioAPI.MCP = {MCP_VERSION, McpServer, BrowserBridge, bindMcpPort, createIdeAdapter};
  const resetDocuments = ide.documents.reset;
  ide.documents.reset = function(...args) {
    const tool = this.tools.get('tool:mcp'); if (tool) this.tools.delete('tool:mcp');
    try { return resetDocuments.apply(this, args); } finally { if (tool) this.openTool(tool); }
  };
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  ide.openMcp = () => { let tool = ide.documents.tools.get('tool:mcp'); if (!tool) tool = new McpPanel(api); ide.documents.openTool(tool); return tool; };
  ide.menu = name => { const items = menu(name); if (name === 'Tools') items.unshift({label: 'MCP Agent Access…', id: 'mcpAgentAccess', icon: 'properties'}, null); return items; };
  ide.command = (id, ...args) => id === 'mcpAgentAccess' ? ide.openMcp() : command(id, ...args);
  return api;
}

class McpPanel {
  constructor(api) {
    this.api = api; this.key = 'tool:mcp'; this.title = 'MCP Agent Access'; this.width = 840; this.height = 640; this.glyph = 'properties';
    this.root = el('div', {class: 'mcp-panel'}); this.disposed = false;
    this.status = el('div', {class: 'mcp-status', role: 'status', 'aria-live': 'polite'}, 'Ready');
    this.summary = el('span', {class: 'mcp-summary-state'}, 'Disabled');
    const access = this.sharingPage(), agent = this.agentPage(), catalog = this.catalogPage(), activity = this.activityPage();
    this.tabs = tabbedPages([{id:'access',label:'Agent access',node:access},{id:'agent',label:'Agent permissions',node:agent},{id:'capabilities',label:'Capabilities',node:catalog},{id:'activity',label:'Activity',node:activity}], {label:'MCP settings'});
    const close = button('Close', () => this.api.closePanel?.()); close.className = 'default-button';
    this.root.append(el('div', {class:'mcp-heading'}, icon('properties'), el('div', {}, el('strong', {}, 'MCP Agent Access'), el('div', {class:'tool-note'}, 'External agents → VB6 Studio')), this.summary), this.tabs,
      el('div', {class:'mcp-footer'}, this.status, button('Stop sharing', () => { this.operation?.abort(); this.api.setSharing(false).catch(e => this.showError(e)); }), close));
    this.disposeChange = api.onChange(() => this.refresh()); this.disposeState = api.adapter.onChange(() => this.refresh()); this.refresh();
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); this.api.closePanel?.(); }
      if (event.key === 'Tab' && event.ctrlKey) {
        event.preventDefault(); event.stopPropagation(); const tabs = [...this.root.querySelectorAll('[role=tab]')];
        const index = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'); tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].click();
        tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].focus();
      }
    });
  }
  dispose() { this.disposed = true; this.operation?.abort(); this.bridgeToken.value = ''; this.disposeChange?.(); this.disposeState?.(); }
  showError(error) { this.status.textContent = String(error.message || error); this.status.classList.add('tool-error'); }
  refresh() {
    if (this.disposed) return;
    const enabled = this.api.adapter.enabled, connected = !!this.api.bridge?.connected, grant = this.api.adapter.permissions.snapshot(this.api.adapter.snapshot().id);
    if (!this.operation) this.sharing.checked = enabled;
    this.connectionStatus.textContent = connected ? 'Connected — external agents can reach this IDE.' : 'Not connected';
    this.summary.textContent = !enabled ? 'Sharing disabled' : connected ? 'Sharing · Relay connected' : 'Sharing · Local access';
    this.agentStatus.textContent = grant.active ? 'Authorized until ' + new Date(grant.expiresAt).toLocaleTimeString() + '\n' + grant.scopes.map(s => AGENT_SCOPES[s]).join('\n') : 'No delegated permissions. Changes require Allow once.';
    this.attachButton.disabled = !enabled || !!this.operation || connected;
    this.grantButton.disabled = !enabled || !!this.operation;
    this.detachButton.disabled = !this.api.bridge && !this.operation;
    this.refreshActivity(); this.refreshCatalog?.();
  }
  async perform(action) {
    if (this.operation) { this.status.textContent = 'Another local setup operation is in progress.'; return; }
    const controller = new AbortController(); this.operation = controller; this.status.classList.remove('tool-error'); this.status.textContent = 'Working…'; this.refresh();
    try { const result = await action(controller.signal); if (!this.disposed) this.status.textContent = 'Ready'; return result; }
    catch (error) { if (!this.disposed) this.showError(error); }
    finally { if (this.operation === controller) this.operation = null; this.refresh(); }
  }
  sharingPage() {
    this.sharing = input('Enable MCP sharing', {type:'checkbox',onchange:() => {
      const enabled = this.sharing.checked;
      if (!enabled) { this.operation?.abort(); this.api.setSharing(false).catch(e => this.showError(e)); return; }
      this.perform(async signal => {
        let abort; const epoch = this.api.adapter.authorityEpoch;
        try {
          const allow = await modal('Share this IDE through MCP?', {content:el('p',{},'External agents can read this project, source, resources, virtual files and debugger data. Writes and execution require approval unless you grant limited-duration permissions. Access stops on reload. Only pair agents you trust.'),
            buttons:[{label:'Cancel',value:false,primary:true},{label:'Enable sharing',value:true}],
            onReady:({finish}) => { abort=()=>finish(false); signal.addEventListener('abort',abort,{once:true}); if(signal.aborted)abort(); }});
          checkAbort(signal);
          if (allow) { if (epoch!==this.api.adapter.authorityEpoch) throw new Error('Project or sharing changed. Review the current project before sharing.'); await this.api.setSharing(true); }
        } finally { if(abort)signal.removeEventListener('abort',abort); }
      });
    }});
    this.bridgeURL=input('Companion URL',{value:'http://127.0.0.1:8766',spellcheck:false});
    this.bridgeToken=input('Companion owner token',{type:'password',autocomplete:'off',spellcheck:false});
    this.connectionStatus=el('span',{role:'status'},'Not connected');
    this.attachButton=button('Attach companion',()=>this.perform(async signal=>{
      const url=companionURL(this.bridgeURL.value).origin, abort=()=>{this.api.detachBridge().catch(()=>{});};
      signal.addEventListener('abort',abort,{once:true});
      try { checkAbort(signal);await this.api.attachBridge({url,token:this.bridgeToken.value}); }
      finally {signal.removeEventListener('abort',abort);this.bridgeToken.value='';}
    }));
    this.detachButton=button('Detach companion',()=>{this.operation?.abort();this.api.detachBridge().catch(e=>this.showError(e));});
    const configuration=()=>({mcpServers:{'vb6-studio':{command:'node',args:['/absolute/path/to/VB6/tools/mcp-stdio.mjs','--url',companionURL(this.bridgeURL.value).origin+'/mcp'],env:{VB6_MCP_TOKEN:'PASTE_CLIENT_TOKEN_FROM_TERMINAL'}}}});
    this.configurationPreview=el('pre',{class:'mcp-description',tabindex:0,'aria-label':'External agent configuration'},JSON.stringify(configuration(),null,2));
    this.bridgeURL.addEventListener('input',()=>{try{this.configurationPreview.textContent=JSON.stringify(configuration(),null,2);}catch{this.configurationPreview.textContent='Enter a valid loopback companion origin to preview configuration.';}});
    const instructions=el('details',{class:'mcp-help'},el('summary',{},'How to start the companion'),
      el('pre',{class:'mcp-description'},'node tools/mcp-bridge.mjs --serve dist --allow-file\n# For hosted use, also allow the page’s exact origin:\n# --origin https://wieslawsoltes.github.io'),
      el('p',{class:'tool-note'},'A static page cannot listen on TCP. Start the local companion yourself. Direct HTML needs --allow-file; hosted pages need their exact origin. Browser local-network restrictions remain in force.'));
    return el('div',{class:'mcp-page'},
      group('Access',el('label',{class:'option-check'},this.sharing,'Enable access for external coding agents'),el('p',{class:'tool-note'},'Agents can inspect the project and debugger. Changes need local approval or permissions from the next tab. The IDE does not connect to external MCP servers.')),
      group('Local companion',field('Companion origin:',this.bridgeURL),field('Owner token:',this.bridgeToken),field('Connection:',this.connectionStatus),
        el('div',{class:'mcp-actions'},this.attachButton,this.detachButton),instructions),
      group('External agent configuration',el('p',{class:'tool-note'},'Use the separate CLIENT token in the external agent. Never give it the owner token.'),
        el('details',{class:'mcp-help'},el('summary',{},'Show stdio configuration template'),this.configurationPreview),
        button('Download agent configuration template',()=>this.perform(()=>download('vb6-agent-mcp.json',JSON.stringify(configuration(),null,2),'application/json')))),
      el('p',{class:'tool-note'},'Protocol '+MCP_VERSION+' with legacy compatibility. Sharing and credentials are memory-only.'));
  }
  agentPage() {
    const scopes=Object.entries(AGENT_SCOPES).map(([key,label])=>({key,label,node:input('Agent scope '+key,{type:'checkbox'})}));
    const minutes=input('Agent permission duration',{type:'number',min:1,max:60,value:10});
    this.agentStatus=el('div',{class:'mcp-permission-status','aria-label':'Agent permission status',role:'status'});
    this.grantButton=button('Grant selected permissions',()=>this.perform(async signal=>{
      if(!this.api.adapter.enabled)throw new Error('Enable sharing first.');
      const selected=scopes.filter(s=>s.node.checked).map(s=>s.key),duration=Number(minutes.value);
      if(!selected.length||!Number.isInteger(duration)||duration<1||duration>60)throw new Error('Choose scopes and a duration from 1 to 60 minutes.');
      const projectId=this.api.adapter.snapshot().id,epoch=this.api.adapter.authorityEpoch,lifetime=AbortSignal.any([signal,this.api.adapter.authoritySignal]);let abort;
      try {
        const accepted=await modal('Authorize coding agents?',{content:el('p',{},'Allow all paired clients to use '+selected.join(', ')+' for '+duration+' minutes in the current project? Execution can run project code and retain its side effects. Only authorize clients you trust.'),
          buttons:[{label:'Cancel',value:false,primary:true},{label:'Authorize session',value:true}],onReady:({finish})=>{abort=()=>finish(false);lifetime.addEventListener('abort',abort,{once:true});if(lifetime.aborted)abort();}});
        checkAbort(lifetime);if(!accepted)return;
        if(epoch!==this.api.adapter.authorityEpoch||projectId!==this.api.adapter.snapshot().id||!this.api.adapter.enabled)throw new Error('Project or sharing changed.');
        this.api.adapter.permissions.allow(projectId,selected,duration);return {authorized:selected,minutes:duration};
      } finally {if(abort)lifetime.removeEventListener('abort',abort);}
    }));
    return el('div',{class:'mcp-page'},el('p',{class:'tool-note'},'Choose which changes all currently paired clients may make without asking each time. No permissions are selected by default.'),
      group('Authorized operations',el('div',{class:'mcp-scope-list'},...scopes.map(s=>el('label',{class:'option-check'},s.node,s.label)))),
      group('Session',field('Duration (minutes):',minutes),this.agentStatus,el('div',{class:'mcp-actions'},this.grantButton,button('Revoke agent permissions',()=>{this.api.adapter.permissions.revoke();this.api.server.revoke();this.refresh();}))),
      el('p',{class:'tool-note'},'Permissions expire after 1–60 minutes and are revoked on project replacement, detachment, sharing disable or reload. Revision and debugger checks always apply. Agents cannot change these settings.'));
  }
  catalogPage() {
    let tools=this.api.adapter.tools.map(({execute,...definition})=>definition).sort((a,b)=>a.name.localeCompare(b.name));
    let definitions=tools;const list=el('select',{size:12,'aria-label':'Exposed agent tools'}),detail=el('pre',{class:'mcp-description',tabindex:0,'aria-label':'Agent tool schema'});
    const search=input('Filter exposed agent tools',{placeholder:'Name or description'}),type=el('select',{'aria-label':'Capability type'},...['Tools','Resources','Prompts'].map(v=>el('option',{value:v},v)));
    const scope=el('select',{'aria-label':'Capability scope'},el('option',{value:''},'All scopes'),...Object.keys(AGENT_SCOPES).map(v=>el('option',{value:v},v)));
    const count=el('span',{class:'tool-note',role:'status'});
    const show=()=>{const def=definitions.find(t=>(t.name||t.uri)===list.value);detail.textContent=def?JSON.stringify(def,null,2):'No matching capabilities.';};
    const render=()=>{
      const previous=list.value,query=search.value.toLowerCase();
      const filtered=definitions.filter(t=>(t.name+' '+t.description+' '+(t.uri||'')).toLowerCase().includes(query)&&(!scope.value||type.value!=='Tools'||agentScope(t.name)===scope.value));
      list.replaceChildren(...filtered.map(t=>el('option',{value:t.name||t.uri},(t.name||t.uri)+(t.annotations?(t.annotations.readOnlyHint?' — read':' — change'):''))));
      list.value=filtered.some(t=>(t.name||t.uri)===previous)?previous:(filtered[0]?.name||filtered[0]?.uri||'');
      count.textContent=filtered.length+' of '+definitions.length+' '+type.value.toLowerCase();show();
    };
    let generation=0;
    this.refreshCatalog=async()=>{
      const current=++generation, selected=type.value;
      try {
        tools=this.api.adapter.tools.map(({execute,...definition})=>definition).sort((a,b)=>a.name.localeCompare(b.name));
        const values=selected==='Tools'?tools:selected==='Resources'?await this.api.adapter.resources():(this.api.adapter.prompts||[]).map(({get,...p})=>p);
        if(this.disposed||generation!==current||selected!==type.value)return;
        definitions=values;scope.disabled=selected!=='Tools';render();
      } catch(error) {if(!this.disposed&&generation===current)this.showError(error);}
    };
    type.addEventListener('change',()=>this.refreshCatalog());
    search.addEventListener('input',render);scope.addEventListener('change',render);list.addEventListener('change',show);render();
    return el('div',{class:'mcp-page mcp-catalog-page'},el('div',{class:'mcp-filter-row'},field('Show:',type),field('Scope:',scope)),field('Filter:',search),count,
      el('div',{class:'mcp-catalog'},list,detail),el('div',{class:'mcp-actions'},button('Download exposed tool schemas',()=>download('vb6-agent-tools.json',JSON.stringify(tools,null,2),'application/json'))),
      el('p',{class:'tool-note'},'Read-only reference. Agents call these operations over MCP; there is no tool runner in the IDE. Begin with vb6.agent.capabilities.'));
  }
  activityPage() {
    this.activityRows=el('tbody');this.activitySearch=input('Filter MCP activity',{placeholder:'Filter operation or error'});this.activityErrors=input('Only MCP errors',{type:'checkbox'});
    this.activityFollow=input('Follow MCP activity',{type:'checkbox',checked:true});this.activity=el('div',{class:'mcp-activity',tabindex:0,'aria-label':'MCP activity'},
      el('table',{},el('thead',{},el('tr',{},...['Time','Direction','Operation','Result'].map(v=>el('th',{scope:'col'},v)))),this.activityRows));
    this.activityCount=el('span',{class:'tool-note'});
    this.activitySearch.addEventListener('input',()=>this.refreshActivity());this.activityErrors.addEventListener('change',()=>this.refreshActivity());
    return el('div',{class:'mcp-page mcp-activity-page'},field('Filter:',this.activitySearch),
      el('div',{class:'mcp-actions'},el('label',{class:'option-check'},this.activityErrors,'Errors only'),el('label',{class:'option-check'},this.activityFollow,'Follow new entries'),this.activityCount),this.activity,
      el('div',{class:'mcp-actions'},button('Save activity…',()=>download('vb6-mcp-activity.json',JSON.stringify(this.api.log,null,2),'application/json')),
        button('Clear activity',()=>{this.api.clearActivity();this.refreshActivity();})),el('p',{class:'tool-note'},'The latest 300 entries are kept in memory. Arguments and credentials are not recorded. Error summaries may include project identifiers; review before sharing.'));
  }
  refreshActivity() {
    if(!this.activityRows)return;
    const query=this.activitySearch.value.toLowerCase(),entries=this.api.log.filter(e=>(!this.activityErrors.checked||e.error)&&(e.method+' '+(e.error||'')).toLowerCase().includes(query));
    const signature=JSON.stringify(entries);if(signature===this.activitySignature)return;this.activitySignature=signature;
    this.activityRows.replaceChildren(...entries.map(e=>el('tr',{},el('td',{},e.time.slice(11,19)),el('td',{},e.direction),el('td',{},e.method),el('td',{title:e.error||'',class:e.error?'tool-error':''},e.error||'OK'))));
    if(!entries.length)this.activityRows.append(el('tr',{},el('td',{colspan:4,class:'mcp-empty'},'No matching activity.')));
    this.activityCount.textContent=entries.length+' entries';if(this.activityFollow.checked)this.activity.scrollTop=this.activity.scrollHeight;
  }
}
