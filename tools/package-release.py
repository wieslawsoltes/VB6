#!/usr/bin/env python3
"""Package the built release without third-party tools. Run validation first."""
from __future__ import annotations
import argparse, hashlib, json, subprocess, zipfile, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
PREFIX=f'VB6-Studio-Web-{VERSION}'
DIRS={'.github','LICENSES','desktop','packages','src','tools','tests','docs','examples','dist','reports'}
ROOT_FILES={'.gitattributes','README.md','RELEASE-NOTES.md','THIRD-PARTY-NOTICES.md','LICENSE','package.json','.gitignore'}
EXCLUDED={'reports/saved-project.vb6web','reports/exported-app.html','reports/features-04/runtime-export.html'}
def digest(data:bytes)->str:return hashlib.sha256(data).hexdigest()
def files():
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file():continue
        rel=p.relative_to(ROOT)
        if rel.parts[0] not in DIRS and str(rel) not in ROOT_FILES:continue
        if any(part in {'.git','node_modules','__pycache__','.native-build'} for part in rel.parts):continue
        if p.suffix in {'.pyc','.sqlite'} or rel.as_posix() in EXCLUDED:continue
        if p.name in {'.env','server-profiles.local.json'} or p.name.startswith('.env.'):continue
        if p.suffix.lower() in {'.ttf','.otf','.woff','.woff2','.eot'}:raise RuntimeError('Font redistribution is not permitted: '+str(rel))
        yield rel,p

def archive(path:Path,entries:dict[str,bytes]):
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,data in sorted(entries.items()):
            info=zipfile.ZipInfo(name,(2026,10,4,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,data)
    with zipfile.ZipFile(path) as z:
        bad=z.testzip()
        if bad:raise RuntimeError('ZIP verification failed: '+bad)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT.parent/'release');parser.add_argument('--git-bundle',action='store_true');options=parser.parse_args();out=options.out.resolve();out.mkdir(parents=True,exist_ok=True)
    if not (ROOT/'dist/VB6-Studio-Web.html').exists():raise SystemExit('Run npm run build and validation first.')
    validation=json.loads((ROOT/'reports/release-validation-06.json').read_text())
    if validation.get('version')!=VERSION or not validation.get('passed'):
        raise RuntimeError('A passing integrated validation report for this version is required.')
    notices={rel.as_posix():p.read_bytes() for rel,p in files() if rel.parts[0]=='LICENSES'}
    source={f'{PREFIX}/{rel.as_posix()}':p.read_bytes() for rel,p in files()}
    manifest=''.join(f'{digest(data)}  {name[len(PREFIX)+1:]}\n' for name,data in sorted(source.items()))
    source[f'{PREFIX}/SOURCE-SHA256SUMS.txt']=manifest.encode()
    archive(out/f'{PREFIX}-Source.zip',source)
    archive(out/f'{PREFIX}-Browser.zip',{str(p.relative_to(ROOT/'dist')):p.read_bytes() for p in sorted((ROOT/'dist').rglob('*')) if p.is_file()} | notices)
    examples={f'apps/{p.name}':p.read_bytes() for p in sorted((ROOT/'dist/examples').glob('*.html'))}
    examples.update({f'projects/{p.name}':p.read_bytes() for p in sorted((ROOT/'examples').glob('*.vb6web'))})
    examples.update(notices)
    examples['README.md']=b'# Standalone examples\n\nEleven independent HTML apps plus their editable browser projects. No IDE or CDN is required to run an app. Open projects in VB6 Studio Web to edit. Browser-specific file-origin restrictions may require serving these files locally.\n'
    archive(out/f'VB6-Example-Apps-{VERSION}.zip',examples)
    sdk=dict(notices)
    for rel,p in files():
        if rel.parts[0]=='src' and rel.parts[1] not in {'ide','designer','editor','exporter'}:sdk[rel.as_posix()]=p.read_bytes()
    for name in ['LICENSE','THIRD-PARTY-NOTICES.md']:sdk[name]=(ROOT/name).read_bytes()
    for name in ['vb6-runtime.js','vb6-controls.css']:sdk[name]=(ROOT/'dist'/name).read_bytes()
    sdk['demo.html']=(ROOT/'dist/examples/richtext.html').read_bytes()
    sdk['mdi.html']=(ROOT/'dist/examples/mdi.html').read_bytes()
    for name in ['ARCHITECTURE.md','COMPATIBILITY.md','TESTING.md','VISUAL-AUDIT.md']:sdk['docs/'+name]=(ROOT/'docs'/name).read_bytes()
    sdk['package.json']=json.dumps({'name':'vb6-browser-runtime','version':VERSION,'private':True,'type':'module','license':'MIT','exports':{'.':'./src/runtime/entry.js','./styles':'./vb6-controls.css'}},indent=2).encode()
    sdk['README.md']=f'''# VB6 browser runtime SDK {VERSION}\n\nIndependent runtime and browser-control modules, without the IDE. See demo.html for a self-contained rich-text application and mdi.html for a runtime MDI/resource application and docs/ARCHITECTURE.md for embedding. The demo embeds its runtime and has no server/CDN dependency.\n\nFor a split page, include vb6-controls.css and vb6-runtime.js, then call `await VB6Runtime.mountApplication(project, container, {{persist:false}})`. For ESM, import `mountApplication` or `RuntimeAPI` from `./src/runtime/entry.js`.\n\nRuntimeAPI includes ResourceStore, readRES/writeRES, setResource/setResourceString, the compiler/VM/host, controls, virtual byte filesystem, Currency, distinct MISSING/Empty/Null/Nothing, VBErrorValue, Gregorian calendar and OLE-date helpers, cells/references, disconnected MemoryRecordset, structured RichTextDocument/parseRTF/writeRTF, and the THEMES/applyTheme/colorValue helpers. Choose the application theme through project.settings.theme before starting. Runtime controls use the shared classic style layer, including ComboBox, UpDown, scrollbars and modal dialogs. Project-defined interfaces, DefType declarations, runtime MDI and explicitly bounded debugger evaluation are described in the compatibility matrix. API contracts are experimental; this is not a native DLL/OCX/ADO runtime.\n\nThe original source package contains the complete tests and build tools. Its validated compatibility boundaries are summarized in docs/COMPATIBILITY.md. No native helper, npm dependency or proprietary font is bundled.\n'''.encode()
    archive(out/f'VB6-Runtime-SDK-{VERSION}.zip',sdk)
    copies={ROOT/'dist/VB6-Studio-Web.html':f'{PREFIX}.html',ROOT/'dist/examples/richtext.html':f'VB6-Rich-Text-Editor-{VERSION}.html',ROOT/'dist/examples/orders.html':f'VB6-Order-Entry-{VERSION}.html',ROOT/'docs/COMPATIBILITY.md':f'{PREFIX}-Compatibility.md',ROOT/'docs/TESTING.md':f'{PREFIX}-Validation.md',ROOT/f'docs/RELEASE-NOTES-{VERSION}.md':f'{PREFIX}-Release-Notes.md',ROOT/'docs/WORKTREES.md':f'{PREFIX}-Worktrees.md',ROOT/'reports/screenshots/ide-designer.png':f'{PREFIX}-preview.png',ROOT/'reports/screenshots/richtext-editor.png':f'{PREFIX}-richtext-preview.png'}
    copies.update({ROOT/'docs/VISUAL-AUDIT.md':f'{PREFIX}-Visual-Audit.md',ROOT/'reports/browser-visual-tests.md':f'{PREFIX}-Visual-Validation.md',ROOT/'reports/visual/classic-designer.png':f'{PREFIX}-preview.png',ROOT/'reports/visual/split-procedure-views.png':f'{PREFIX}-split-code-preview.png',ROOT/'reports/visual/contrast-code.png':f'{PREFIX}-contrast-preview.png'})
    copies.update({ROOT/'dist/examples/compatibility.html':f'VB6-Runtime-Workbench-{VERSION}.html',ROOT/'reports/features-04/object-browser-classic.png':f'{PREFIX}-object-browser.png',ROOT/'reports/features-04/project-search.png':f'{PREFIX}-project-search.png',ROOT/'reports/features-04/bookmarks-split.png':f'{PREFIX}-bookmarks.png',ROOT/'reports/features-04/runtime-workbench.png':f'{PREFIX}-runtime-preview.png',ROOT/'reports/browser-features-04.md':f'{PREFIX}-Feature-Validation.md'})
    copies.update({ROOT/'dist/examples/mdi.html':f'VB6-MDI-Workspace-{VERSION}.html',ROOT/'reports/boundaries-06/mdi-runtime.png':f'{PREFIX}-mdi-preview.png',ROOT/'reports/boundaries-06/resource-editor.png':f'{PREFIX}-resource-editor.png',ROOT/'reports/boundaries-06/explicit-evaluation.png':f'{PREFIX}-evaluation-preview.png'})
    for src,name in copies.items():shutil.copyfile(src,out/name)
    visual={f'screenshots/{p.name}':p.read_bytes() for p in sorted((ROOT/'reports/visual').glob('*.png'))}
    for rel in ['docs/VISUAL-AUDIT.md','reports/browser-visual-tests.json','reports/browser-visual-tests.md','tests/visual-goldens.json']:visual[rel]=(ROOT/rel).read_bytes()
    visual.update({f'features/{p.name}':p.read_bytes() for p in sorted((ROOT/'reports/features-04').glob('*.png'))})
    for rel in ['reports/browser-features-04.json','reports/browser-features-04.md','reports/visual-review-06.json']:visual[rel]=(ROOT/rel).read_bytes()
    visual.update({f'finalization/{p.name}':p.read_bytes() for p in sorted((ROOT/'reports/finalization-05').glob('*.png'))})
    visual.update({f'recovered-tools/{p.name}':p.read_bytes() for p in sorted((ROOT/'reports/recovery').glob('*.png'))})
    for rel in ['reports/finalization-05/browser-finalization-05.json','reports/finalization-05/browser-finalization-05.md','reports/release-validation-06.json']:
        visual[rel]=(ROOT/rel).read_bytes()
    visual.update({f'boundaries/{p.name}':p.read_bytes() for p in sorted((ROOT/'reports/boundaries-06').glob('*.png')) if not p.name.startswith('failed-')})
    visual['reports/boundaries-06/browser-boundaries-06.json']=(ROOT/'reports/boundaries-06/browser-boundaries-06.json').read_bytes()
    archive(out/f'{PREFIX}-Visual-Review.zip',visual)
    for source,name in [('workspace-restored.png','workspace-preview.png'),('paused-data-tip.png','debugger-preview.png'),('large-editor-completion.png','editor-preview.png')]:
        shutil.copyfile(ROOT/'reports/finalization-05'/source,out/f'{PREFIX}-{name}')
    shutil.copyfile(ROOT/'reports/release-validation-06.json',out/f'{PREFIX}-Validation.json')
    if options.git_bundle:
        subprocess.run(['git','bundle','create',str(out/f'{PREFIX}-history.bundle'),'--all'],cwd=ROOT,check=True)
        subprocess.run(['git','bundle','verify',str(out/f'{PREFIX}-history.bundle')],cwd=ROOT,check=True)
    prefixes=(PREFIX,f'VB6-Example-Apps-{VERSION}',f'VB6-Runtime-SDK-{VERSION}',f'VB6-Order-Entry-{VERSION}',f'VB6-Rich-Text-Editor-{VERSION}',f'VB6-Runtime-Workbench-{VERSION}',f'VB6-MDI-Workspace-{VERSION}')
    selected=sorted(p for p in out.iterdir() if p.is_file() and p.name.startswith(prefixes) and not p.name.endswith('-SHA256SUMS.txt'))
    (out/f'{PREFIX}-SHA256SUMS.txt').write_text(''.join(f'{digest(p.read_bytes())}  {p.name}\n' for p in selected))
    print(json.dumps({p.name:p.stat().st_size for p in selected},indent=2))
if __name__=='__main__':main()
