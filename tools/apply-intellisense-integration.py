# Temporary, hash-checked integration; removed before the final review commit.
from pathlib import Path
import hashlib, subprocess
changes = {'src/editor/editor.js': {'sha256': '1710d2e0b66cfd577116631cef4d969ab21b606ecc61ae6ccdd1a3f26de9cc74', 'edits': [[31965, 32086, "bounds=node.getBoundingClientRect(),cursor=this.cursor(),height=Math.ceil(bounds.height)||(node.classList.contains('completion-list')?180:50),width=Math.ceil(bounds.width)"], [32414, 32414, '-2']]}, 'tools/browser-intellisense-tests.py': {'sha256': 'ed25f6cbf32bbc7087dd1df36e7fd25ce244e20d34e224431b2287337897d7a3', 'edits': [[4161, 4202, "p.evaluate('()=>{const e=vb6Studio.editor;return JSON.stringify({info:e.info.getBoundingClientRect(),pane:e.viewport.getBoundingClientRect(),scrollWidth:e.info.scrollWidth,clientWidth:e.info.clientWidth});}')"]]}}
for name, change in changes.items():
    path=Path(name);source=path.read_text()
    assert hashlib.sha256(source.encode()).hexdigest()==change['sha256'], 'Source changed; rebase before applying '+name
    for start,end,value in reversed(change['edits']):source=source[:start]+value+source[end:]
    path.write_text(source)
subprocess.run(['git','add','-u'],check=True)
