from pathlib import Path
import subprocess,re
root=Path.cwd()
MAIN='e7cfde0a219569f4ab5bd5abadb2d337b6722efb'
base='refs/remotes/current/main'
subprocess.run(['git','update-ref',base,MAIN],check=True)
result=subprocess.run(['git','-c','user.name=Integration','-c','user.email=integration@users.noreply.github.com','merge','--no-commit','--no-ff',base])
if result.returncode not in (0,1):
 raise RuntimeError('Unable to prepare three-way merge')
def git(*args):
 return subprocess.check_output(['git',*args],cwd=root)
for path in ['desktop/studio.mjs','desktop/smoke.cjs','src/ide/runtime-document.js','tests/native-preview.test.mjs']:
 (root/path).write_bytes(git('show',f'{base}:{path}'))
p=root/'src/ide/main.js';text=p.read_text()
text,n=re.subn(r'<<<<<<< HEAD\n.*?=======\n(.*?)>>>>>>> refs/remotes/current/main\n',lambda m:m[1],text,flags=re.S)
assert n==1 and '<<<<<<<' not in text
p.write_text(text)
p=root/'src/ide/runtime-document.js';text=p.read_text()
text=text.replace('export function loadRuntimeDocument(', 'const requests = new WeakMap();\n\nexport function loadRuntimeDocument(')
text=text.replace('  const current = () => frame.isConnected && isCurrent();\n  if (!current()) return;', '''  // Request identity is separate from session identity: an active session can
  // prepare more than one document for the same iframe (for example on restart).
  if (!frame.isConnected || !isCurrent()) return;
  const request = {};
  requests.set(frame, request);
  const current = () => requests.get(frame) === request && frame.isConnected && isCurrent();''')
p.write_text(text)
p=root/'tests/native-preview.test.mjs';text=p.read_text();text+='''

test('older approvals cannot overwrite a newer document prepared for the same frame',async()=>{
  const first=defer(),second=defer(),s=setup(html=>html==='first'?first.promise:second.promise);
  const old=s.load(s.frame,'first'),next=s.load(s.frame,'second');
  second.resolve(url);await next;first.resolve('vb6://app/preview/'+'b'.repeat(32));await old;
  assert.equal(s.frame.src,url);assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
});
test('older approval failures cannot stop a newer request on the same frame',async()=>{
  const first=defer(),second=defer(),s=setup(html=>html==='first'?first.promise:second.promise);
  const old=s.load(s.frame,'first'),next=s.load(s.frame,'second');
  first.reject(Error('obsolete same-frame request'));await old;
  assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
  second.resolve(url);await next;assert.equal(s.frame.src,url);
});
test('native document preparation leaves sandbox and referrer policy unchanged',async()=>{
  const s=setup(()=>url);s.frame.sandbox='allow-scripts allow-downloads allow-modals';s.frame.referrerPolicy='no-referrer';
  const removed=[];s.frame.removeAttribute=name=>removed.push(name);
  await s.load(s.frame,'source');assert.equal(s.frame.src,url);
  assert.equal(s.frame.sandbox,'allow-scripts allow-downloads allow-modals');assert.equal(s.frame.referrerPolicy,'no-referrer');
  assert.deepEqual(removed,['srcdoc']);
});
test('independent runtime frames can prepare documents concurrently without retiring each other',async()=>{
  const first=defer(),second=defer(),errors=[];
  const ide={runtimeDocumentLoader:createNativeRuntimeDocumentLoader({runtimeDocument:html=>html==='first'?first.promise:second.promise})};
  const frames=[{isConnected:true,removeAttribute(){}},{isConnected:true,removeAttribute(){}}];
  const load=(frame,html)=>loadRuntimeDocument(ide,frame,html,{isCurrent:()=>true,onError:error=>errors.push(error)});
  const a=load(frames[0],'first'),b=load(frames[1],'second');
  second.resolve(url);await b;first.resolve('vb6://app/preview/'+'b'.repeat(32));await a;
  assert.equal(frames[0].src,'vb6://app/preview/'+'b'.repeat(32));assert.equal(frames[1].src,url);assert.deepEqual(errors,[]);
});
''';p.write_text(text)
p=root/'docs/OCX-SUPPORT.md';text=p.read_text()+'''

The shared loader is also used by native design-mode Immediate and its promotion
into event debugging. Session guards prevent stale responses from a retired run;
per-frame request guards additionally prevent an older approval or failure from
overwriting or stopping a newer document request on the same active iframe.
Independent frames do not cancel one another. Preview loading does not change
sandbox permissions, CSP, or native IPC authorization. The native smoke covers
F5/Reset/restart and Immediate/event-mode promotion through this shared path.
''';p.write_text(text)
subprocess.run(['git','checkout','--ours','--','dist','src/exporter/runtime-payload.js'],check=True)
subprocess.run(['npm','run','build'],check=True)
subprocess.run(['git','add','-u'],check=True)
assert not git('diff','--name-only','--diff-filter=U').strip()
# Compare the entire merged tracked tree to the locally built and tested source.
subprocess.run(['git','rm','--cached','.ocx-resume.py','.github/workflows/ocx-resume.yml'],check=True)
actual=git('write-tree').decode().strip()
assert actual=='45567462a4bd313a6ea555086072adb8f33243ce',actual
print('EXACT_TESTED_TREE',actual)
