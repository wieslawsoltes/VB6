#!/usr/bin/env python3
"""Package the recovered development tree, not a new numbered release.
This packaging script was written during recovery. It does not claim tests ran;
validation reports must be inspected separately. No baseline fallback is used.
"""
import argparse, hashlib, json, shutil, subprocess, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PREFIX='VB6-Recovered-IDE-Development'
ALLOWED={'LICENSES','src','tools','tests','docs','examples','dist','reports','recovery'}
ROOT_FILES={'.gitignore','LICENSE','README.md','RECOVERY.md','RELEASE-NOTES.md','THIRD-PARTY-NOTICES.md','package.json'}
EXCLUDE={'reports/saved-project.vb6web','reports/exported-app.html','reports/features-04/runtime-export.html'}
FONT_EXT={'.ttf','.otf','.woff','.woff2','.eot','.fon','.fnt'}
def sha(data):return hashlib.sha256(data).hexdigest()
def archive(path,entries):
    if not entries:raise RuntimeError('Refusing to write empty archive '+str(path))
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,data in sorted(entries.items()):
            if Path(name).suffix.lower() in FONT_EXT:raise RuntimeError('Font file excluded: '+name)
            info=zipfile.ZipInfo(name,(2026,10,4,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,data)
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None:raise RuntimeError('ZIP CRC verification failed: '+str(path))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT.parent/'recovered-delivery');parser.add_argument('--git-bundle',action='store_true');args=parser.parse_args()
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    built=ROOT/'dist/VB6-Studio-Web.html'
    if not built.is_file():raise RuntimeError('Built app is missing. Run npm run build. No fallback is permitted.')
    entries={}
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file():continue
        rel=p.relative_to(ROOT)
        if rel.parts[0] not in ALLOWED and str(rel) not in ROOT_FILES:continue
        if '__pycache__' in rel.parts or p.suffix=='.pyc' or rel.as_posix() in EXCLUDE:continue
        if p.suffix.lower() in FONT_EXT:raise RuntimeError('Unexpected font file: '+str(rel))
        entries[rel.as_posix()]=p.read_bytes()
    notices={name:data for name,data in entries.items() if name.startswith('LICENSES/')}
    manifest=''.join(f'{sha(data)}  {name}\n' for name,data in sorted(entries.items()))
    source={PREFIX+'/'+name:data for name,data in entries.items()};source[PREFIX+'/SOURCE-SHA256SUMS.txt']=manifest.encode()
    archive(out/(PREFIX+'-Source.zip'),source)
    archive(out/(PREFIX+'-Browser.zip'),{p.relative_to(ROOT/'dist').as_posix():p.read_bytes() for p in sorted((ROOT/'dist').rglob('*')) if p.is_file()} | notices)
    apps={'apps/'+p.name:p.read_bytes() for p in sorted((ROOT/'dist/examples').glob('*.html'))}
    apps.update({'projects/'+p.name:p.read_bytes() for p in sorted((ROOT/'examples').glob('*.vb6web'))});apps['RECOVERY.md']=(ROOT/'RECOVERY.md').read_bytes()
    apps.update(notices)
    archive(out/(PREFIX+'-Examples.zip'),apps)
    sdk={name:data for name,data in entries.items() if name.startswith('src/') and name.split('/')[1] not in {'ide','designer','editor','exporter'}}
    sdk.update(notices)
    for name in ['LICENSE','THIRD-PARTY-NOTICES.md','RECOVERY.md']:sdk[name]=(ROOT/name).read_bytes()
    for name in ['vb6-runtime.js','vb6-controls.css']:sdk[name]=(ROOT/'dist'/name).read_bytes()
    sdk['demo.html']=(ROOT/'dist/examples/richtext.html').read_bytes()
    sdk['package.json']=json.dumps({'name':'vb6-browser-runtime-recovered','version':'0.4.0-recovered','private':True,'type':'module','license':'MIT','exports':{'.':'./src/runtime/entry.js','./styles':'./vb6-controls.css'}},indent=2).encode()
    sdk['README.md']=b'# Recovered browser runtime SDK\n\nDevelopment reconstruction based on VB6 Studio Web 0.4.0 with recovered debugger bridge/inspection additions. Not a native COM/OCX runtime or parity-certified release.\n\nImport mountApplication/RuntimeAPI from src/runtime/entry.js for ESM, or load vb6-controls.css and vb6-runtime.js and use VB6Runtime.mountApplication(project, container, {persist:false}). The full source package contains tests and reports. demo.html is self-contained. RECOVERY.md explains provenance and limits.\n'
    archive(out/(PREFIX+'-Runtime-SDK.zip'),sdk)
    shutil.copy2(built,out/(PREFIX+'.html'));shutil.copy2(ROOT/'RECOVERY.md',out/(PREFIX+'-Report.md'))
    if args.git_bundle:
        target=out/(PREFIX+'-History.bundle')
        subprocess.run(['git','bundle','create',str(target),'--all'],cwd=ROOT,check=True)
        subprocess.run(['git','bundle','verify',str(target)],cwd=ROOT,check=True)
    targets=sorted(p for p in out.glob(PREFIX+'*') if p.is_file() and not p.name.endswith('-SHA256SUMS.txt'))
    (out/(PREFIX+'-SHA256SUMS.txt')).write_text(''.join(f'{sha(p.read_bytes())}  {p.name}\n' for p in targets))
    print(json.dumps({'source_manifest_files':len(entries),'artifacts':{p.name:{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in targets}},indent=2))
if __name__=='__main__':main()
