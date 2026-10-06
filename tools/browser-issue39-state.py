#!/usr/bin/env python3
"""Real caption positioning and disabled-ink regressions for issue #39.

Run all engines in CI over actual HTTP/file URLs. --inline is explicitly local
review only. Fixture-only checks cannot validate a real floating toolbar's flow.
"""
from __future__ import annotations
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import threading
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--engine', choices=['chromium', 'firefox', 'webkit'], default='chromium')
parser.add_argument('--inline', action='store_true')
args = parser.parse_args()
OUT = ROOT / 'reports' / 'issue39-state' / args.engine
OUT.mkdir(parents=True, exist_ok=True)
HTML = (ROOT / 'dist/VB6-Studio-Web.html').read_text(encoding='utf-8')
results = []

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()

def check(value, message):
    if not value:
        raise AssertionError(message)

def load(browser, mode, dpr=1):
    page = browser.new_page(viewport={'width': 1312, 'height': 966}, device_scale_factor=dpr)
    page.set_default_timeout(8000)
    page.errors = []
    page.on('pageerror', lambda error: page.errors.append(str(error)))
    if mode == 'inline':
        page.set_content(HTML)
    else:
        page.goto(f'http://127.0.0.1:{server.server_port}/dist/VB6-Studio-Web.html'
                  if mode == 'http' else (ROOT / 'dist/VB6-Studio-Web.html').as_uri())
    page.wait_for_function('window.vb6Studio')
    return page

def floating(page):
    page.evaluate('vb6Studio.commandBars.dock("standard", "float")')
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    bar = page.locator('[data-command-bar="standard"]')
    close = bar.get_by_role('button', name='Hide Standard toolbar', exact=True)
    def assert_caption():
        geometry = close.evaluate('''b => {
          const r=b.getBoundingClientRect(),p=b.parentElement.getBoundingClientRect();
          const grip=b.parentElement.querySelector('.toolbar-grip').getBoundingClientRect();
          return {position:getComputedStyle(b).position,left:r.left-p.left,
            right:p.right-r.right,top:r.top-p.top,bottom:r.bottom-p.top,
            width:r.width,height:r.height,captionBottom:grip.bottom-p.top,
            hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
        }''')
        check(geometry['position'] == 'absolute', f'Close button moved into command flow: {geometry}')
        check(geometry['width'] == 15 and geometry['height'] == 15, f'Caption button resized: {geometry}')
        check(0 <= geometry['right'] <= 5 and 0 <= geometry['top'] <= 4
              and geometry['bottom'] <= geometry['captionBottom'], f'Close button left caption: {geometry}')
        check(geometry['hit'], f'Close button covered by the toolbar grip: {geometry}')
        return geometry
    original = assert_caption()
    grip = bar.locator('.toolbar-grip').bounding_box()
    before = bar.bounding_box()
    page.mouse.move(grip['x'] + grip['width'] / 2, grip['y'] + 8)
    page.mouse.down()
    page.mouse.move(grip['x'] + grip['width'] / 2 + 80, grip['y'] + 68, steps=8)
    page.mouse.up()
    after = bar.bounding_box()
    check(after['x'] != before['x'] or after['y'] != before['y'], 'Floating toolbar did not move')
    assert_caption()
    close.click()
    check(bar.is_hidden(), 'Pointer Close did not hide toolbar')
    page.evaluate('vb6Studio.commandBars.show("standard", true)')
    assert_caption()
    close.focus()
    page.keyboard.press('Enter')
    check(bar.is_hidden(), 'Keyboard Close did not hide toolbar')
    page.evaluate('vb6Studio.commandBars.dock("standard", "top")')
    check(bar.is_visible() and bar.get_attribute('data-dock') == 'top', 'Toolbar failed to redock')
    check(not page.errors, str(page.errors))
    return original

def disabled_ink(page):
    help_button = page.locator('.app-title button[title="About this application"]')
    help_button.evaluate('b => b.disabled=true')
    page.emulate_media(forced_colors='active')
    supported = page.evaluate('matchMedia("(forced-colors: active)").matches')
    if not supported:
        return {'forcedColorsSupported': False, 'notExercised': 'Browser does not emulate forced-colors'}
    gray = page.evaluate('''() => {
      const n=document.createElement('span');n.style.cssText='color:GrayText;forced-color-adjust:none';
      document.body.append(n);const result=getComputedStyle(n).color;n.remove();return result;
    }''')
    check(help_button.evaluate('b=>getComputedStyle(b,"::after").backgroundColor') == gray,
          'Disabled Help mask incorrectly uses enabled ButtonText in forced colors')
    # ARIA-disabled icon buttons must use the same ink as native-disabled ones.
    maximize = page.locator('.app-title button').filter(has=page.locator('[data-icon="maximize"]')).first
    check(maximize.count() == 1, 'Application maximize caption not found')
    maximize.evaluate('b => {b.disabled=false;b.setAttribute("aria-disabled","true")}')
    check(maximize.locator('.icon').evaluate('n=>getComputedStyle(n,"::after").backgroundColor') == gray,
          'ARIA-disabled caption uses enabled ink in forced colors')
    check(not page.errors, str(page.errors))
    return {'forcedColorsSupported': True, 'nativeAndAriaDisabledInk': gray}

try:
    with sync_playwright() as playwright:
        options = {'headless': True}
        if args.engine == 'chromium':
            options.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
                           or playwright.chromium.executable_path, args=['--no-sandbox'])
        browser = getattr(playwright, args.engine).launch(**options)
        version = browser.version
        for mode in (['inline'] if args.inline else ['http', 'file']):
            for name, test, dpr in [('floating caption, drag and hide', floating, 1),
                                    ('floating caption fractional DPI', floating, 1.25),
                                    ('disabled forced-color caption ink', disabled_ink, 1)]:
                page = load(browser, mode, dpr)
                label = f'{mode}: {name}'
                try:
                    details = test(page)
                    unsupported = bool(details.get('notExercised'))
                    results.append({'name': label, 'passed': not unsupported, 'skipped': unsupported,
                                    'details': details})
                    print('SKIP' if unsupported else 'PASS', label, details, flush=True)
                    page.screenshot(path=OUT/f'{mode}-{name.split(",")[0].replace(" ", "-")}-{dpr}.png')
                except Exception as error:
                    results.append({'name': label, 'passed': False, 'skipped': False, 'error': str(error)})
                    print('FAIL', label, error, flush=True)
                    traceback.print_exc(limit=2)
                    page.screenshot(path=OUT/f'failure-{len(results)}.png')
                finally:
                    page.context.close()
        browser.close()
finally:
    server.shutdown()
summary = {'passed': sum(r['passed'] for r in results),
           'skipped': sum(r['skipped'] for r in results),
           'failed': sum(not r['passed'] and not r['skipped'] for r in results)}
(OUT/'results.json').write_text(json.dumps({'summary': summary, 'engine': args.engine,
    'version': version, 'inline': args.inline, 'results': results}, indent=2), encoding='utf-8')
print(summary)
raise SystemExit(bool(summary['failed']))
