"""Exact retained-renderer overflow regression, owned by the IDE theme suite.

A fixed native HTML capture is the oracle for each state. Native edge coverage
must not be replaced by partially clipped opaque child paint. This is renderer
parity, not a claim of comparison with a native Motif installation.
"""
from pathlib import Path
from urllib.parse import urljoin
import os
from rendering_pixels import compare_pixels

ROOT = Path(__file__).resolve().parents[1]
DPRS = (1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3)
FIXTURE = '''<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#bdbdb3}
#box{position:absolute;left:32px;top:32.40625px;width:242px;height:241.640625px;
 box-sizing:border-box;border:1px solid #66665c;background:#fffff4;
 box-shadow:inset 2px 2px #66665c,inset -2px -2px #f2f2e8;overflow:auto}
.row{height:17px;box-sizing:border-box;border-bottom:1px solid #929287;display:flex;background:#fffff4}
.name{width:46%;height:16px;border-right:1px solid #929287;overflow:hidden;
 white-space:nowrap;font:11px/16px Arial}.value{flex:1;overflow:hidden;font:11px/16px Arial}
html.dark,html.dark body{background:#343c3e;color:#ecede4}
html.dark #box{border-color:#151d20;background:#242c2e;
 box-shadow:inset 2px 2px #151d20,inset -2px -2px #858f90}
html.dark .row{background:#242c2e;border-color:#606b6d}
html.dark .name{border-color:#606b6d}
</style><div id="box">''' + ''.join(
    '<div class="row"><div class="name">Mode</div><div class="value">Value</div></div>'
    for _ in range(40)) + '</div><script src="../../../dist/vb6-rendering.js"></script>'


def stable_capture(test, page, backend, output):
    """Stabilize independently; do not retry a comparison against its oracle."""
    previous = None
    consecutive = 0
    for _ in range(30):
        test.assertEqual(page.evaluate('renderer.backend'), backend)
        page.evaluate('''async()=>{await document.fonts.ready;
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}''')
        current = page.screenshot(caret='initial')
        identical = previous is not None and compare_pixels(previous, current)['changedPixels'] == 0
        consecutive = consecutive + 1 if identical else 1
        if consecutive == 3:
            output.write_bytes(current)
            return current
        previous = current
    test.fail('Overflow fixture did not produce three consecutive stable captures')


class X11OverflowChecks:
    def test_x11_fractional_scroll_clips_keep_exact_retained_pixels(self):
        folder = ROOT / 'reports' / 'ide-themes' / 'overflow-fixtures'
        folder.mkdir(parents=True, exist_ok=True)
        fixture = folder / 'grid.html'
        fixture.write_text(FIXTURE)
        report = ROOT / 'reports' / 'ide-themes' / os.environ.get('VB6_BROWSER', 'chromium') / 'overflow'
        report.mkdir(parents=True, exist_ok=True)
        for dpr in DPRS:
            context = self.browser.new_context(viewport={'width':400, 'height':320}, device_scale_factor=dpr)
            errors = []
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            try:
                if os.environ.get('VB6_TEST_TRANSPORT') == 'memory':
                    page.set_content(FIXTURE.replace('<script src="../../../dist/vb6-rendering.js"></script>', ''))
                    page.add_script_tag(content=(ROOT / 'dist/vb6-rendering.js').read_text())
                else:
                    page.goto(urljoin(self.url, '../reports/ide-themes/overflow-fixtures/grid.html'))
                page.wait_for_function('typeof VB6Rendering === "object"')
                page.evaluate('''async()=>{window.renderer=new VB6Rendering.UIRenderer(document,{backend:'html'});await renderer.ready}''')
                for theme in ('x11', 'x11-dark'):
                    page.evaluate('dark=>document.documentElement.classList.toggle("dark",dark)', theme.endswith('dark'))
                    for scroll in (0, 37):
                        with self.subTest(theme=theme, dpr=dpr, scroll=scroll):
                            page.evaluate('renderer.setOptions({backend:"html"})')
                            page.evaluate('top=>document.querySelector("#box").scrollTop=top', scroll)
                            prefix = f'{theme}-{dpr}-{scroll}'
                            reference = stable_capture(self, page, 'html', report / (prefix + '-html.png'))
                            geometry = page.locator('#box').evaluate('e=>[e.scrollTop,e.scrollWidth,e.scrollHeight,e.clientWidth,e.clientHeight]')
                            page.evaluate('renderer.setOptions({backend:"canvas2d",fallbacks:["html"],text:"native"})')
                            image = stable_capture(self, page, 'canvas2d', report / (prefix + '-canvas2d.png'))
                            comparison = compare_pixels(reference, image)
                            self.assertEqual(comparison['changedPixels'], 0, str(comparison))
                            self.assertEqual(page.locator('#box').evaluate('e=>[e.scrollTop,e.scrollWidth,e.scrollHeight,e.clientWidth,e.clientHeight]'), geometry)
                            # An all-native fallback could pass screenshots. Require an
                            # opaque retained interior far from borders, text and clips.
                            alpha = page.evaluate('''()=>renderer.canvas.getContext('2d').getImageData(
                              Math.floor(230*devicePixelRatio),Math.floor(42*devicePixelRatio),1,1).data[3]''')
                            self.assertEqual(alpha, 255, 'Grid interior must remain retained paint')
                            self.record(theme, fixture='overflow', dpr=dpr, scroll=scroll,
                                        backend='canvas2d', opaqueInterior=True, **comparison)
                self.assertEqual(errors, [])
            finally:
                context.close()
