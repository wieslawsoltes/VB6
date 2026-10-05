"""Offline real-browser fixtures using the same bundler as shipped applications."""
from contextlib import contextmanager
from pathlib import Path
import os
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

@contextmanager
def fixture():
    bundled = subprocess.run(
        ['node', '--input-type=module', '-e',
         "import {bundle} from './tools/bundle.mjs';process.stdout.write(bundle('./tools/input-designer-fixture.mjs','Fixture'));"],
        cwd=ROOT, check=True, capture_output=True, text=True).stdout
    with sync_playwright() as playwright:
        name = os.environ.get('VB6_BROWSER', 'chromium')
        options = {'headless': True}
        if name == 'chromium' and os.environ.get('CHROMIUM_PATH'):
            options['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = getattr(playwright, name).launch(**options)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            page.set_default_timeout(5000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content('<!doctype html><title>Input regressions</title><main id="test"></main>')
            page.add_style_tag(content=(ROOT / 'dist/studio.css').read_text())
            page.add_style_tag(content='html,body,#test{width:100%;height:100%;margin:0}#test{position:relative;overflow:auto}.code-pane{position:relative;height:480px}')
            page.add_script_tag(content=bundled)
            yield page
            assert not errors, errors
        finally:
            browser.close()
