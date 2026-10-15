import fs from 'node:fs';
import {bundle} from './bundle.mjs';
fs.mkdirSync('reports/graphics/fixtures',{recursive:true});
const styles=['src/theme/palette.css','src/theme/common.css','src/controls/controls.css','src/controls/tabs.css','src/theme/bevels.css','src/theme/fidelity.css','src/theme/icon-packs.css','src/theme/application-palettes.css','src/theme/application-themes.css','src/theme/command-bevels.css','src/theme/details.css','src/theme/winui-controls.css'].map(path=>fs.readFileSync(path,'utf8')).join('\n');
fs.writeFileSync('reports/graphics/fixtures/suite.css',styles);
const scripts=bundle('src/runtime/entry.js','GraphicsRuntime')+'\n'+bundle('tests/graphics-browser.js','GraphicsTests');
fs.writeFileSync('reports/graphics/fixtures/suite.js',scripts);
fs.writeFileSync('reports/graphics/fixtures/suite.html','<!doctype html><meta charset="utf-8"><title>Retained graphics acceptance</title><style>'+styles+'</style><script>'+scripts.replace(/<\/script/gi,'<\\/script')+'</script>');
