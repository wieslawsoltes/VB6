/** Reproducible standalone demonstration of source UserControl and portable hosting. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseFRM} from '../src/project/formats.js';

export function renderOcxLab({source, runtime, template}) {
  // Native .ctl files deliberately retain their own checkout/encoding policy.
  // Normalize only this generated demonstration's embedded text, not user files.
  source = source.replace(/\r\n?/g, '\n');
  template = template.replace(/\r\n?/g, '\n');
  const {module} = parseFRM(source, 'Gauge.ctl');
  module.id = 'source-gauge-module';
  module.form.id = 'source-gauge-form';
  module.form.controls.forEach((control, i) => {
    control.id = 'source-gauge-child-' + i;
    control.nativeParentId = module.form.id;
  });
  const project = {name: 'ControlsLab', startup: '(None)', modules: [module]};
  const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('<!--RUNTIME-->', () => '<script>' + runtime.replace(/<\/script/gi, '<\\/script') + '</script>')
    .replace('/*PROJECT*/null', () => safeJSON(project))
    .replace("/*CTL_SOURCE*/''", () => safeJSON(source));
}

export function buildOcxLab(root = path.resolve(import.meta.dirname, '..')) {
  const input = path.join(root, 'examples/ocx-source');
  const html = renderOcxLab({
    source: fs.readFileSync(path.join(input, 'Gauge.ctl'), 'utf8'),
    runtime: fs.readFileSync(path.join(root, 'dist/vb6-runtime.js'), 'utf8'),
    template: fs.readFileSync(path.join(input, 'lab.template.html'), 'utf8')
  });
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true});
  fs.writeFileSync(path.join(root, 'dist/OCX-Source-Control-Lab.html'), html);
  console.log('Built standalone OCX source-control lab (' + Buffer.byteLength(html) + ' bytes).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildOcxLab();
