#!/usr/bin/env python3
"""Real Data Link Properties geometry and input regression, without network I/O."""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/data-sources'
OUT.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as pw:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path
    browser = pw.chromium.launch(executable_path=executable, args=['--no-sandbox'])
    try:
        for width in (1440, 580):
            page = browser.new_page(viewport={'width': width, 'height': 960})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content((ROOT / 'dist/VB6-Studio-Web.html').read_text())
            page.wait_for_function('globalThis.vb6Studio')
            page.evaluate('vb6Studio.command("dataEnvironment")')
            tool = page.locator('.data-environment')
            tool.get_by_role('button', name='Add Connection', exact=True).click()
            page.get_by_role('tab', name='Connection', exact=True).click()
            page.get_by_label('Connection name', exact=True).fill('LayoutCheck')
            checkbox = page.get_by_label('Read-only connection', exact=True)
            box = checkbox.bounding_box()
            assert box and box['width'] == 13 and box['height'] == 13, box
            checkbox.focus()
            checkbox.press('Space')
            assert checkbox.is_checked()
            page.get_by_role('tab', name='All', exact=True).click()
            config = json.loads(page.get_by_label('All connection properties', exact=True).input_value())
            assert config['readOnly'] is True
            page.get_by_role('button', name='OK', exact=True).last.click()
            page.wait_for_function('vb6Studio.project.dataSources.connections.some(c => c.name === "LayoutCheck" && c.readOnly)')
            tool.get_by_role('button', name='Properties', exact=True).click()
            checkbox = page.get_by_label('Read-only connection', exact=True)
            assert checkbox.is_checked()
            checkbox.uncheck()
            page.get_by_role('button', name='Cancel', exact=True).last.click()
            assert page.evaluate('vb6Studio.project.dataSources.connections.find(c => c.name === "LayoutCheck").readOnly')
            tool.get_by_role('button', name='Properties', exact=True).click()
            assert page.get_by_label('Read-only connection', exact=True).is_checked()
            assert not errors, errors
            page.screenshot(path=str(OUT / f'data-link-layout-{width}.png'))
            results.append({'width': width, 'passed': True, 'checkbox': box})
            print('PASS Data Link Properties geometry, keyboard, persistence and Cancel:', width, flush=True)
            page.close()
    finally:
        browser.close()
        (OUT / 'layout-results.json').write_text(json.dumps(results, indent=2))
