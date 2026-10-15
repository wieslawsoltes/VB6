import json
from pathlib import Path
from playwright.sync_api import sync_playwright

# One-use diagnosis on an isolated branch, never merged into production.
Path('reports').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.webkit.launch()
    page=browser.new_page(viewport={'width':800,'height':800})
    report={'browser':browser.version,'cases':[]}
    styles=['writing-mode:vertical-lr;direction:rtl',
            'writing-mode:vertical-lr!important;direction:rtl',
            'writing-mode:vertical-lr;direction:rtl;appearance:none',
            '-webkit-appearance:slider-vertical;direction:rtl',
            'writing-mode:vertical-lr;direction:rtl;appearance:none;display:block']
    for style in styles:
        page.set_content('<input type="range" min="0" max="100" value="50" style="position:absolute;left:100px;top:100px;width:30px;height:240px;'+style+'">')
        control=page.locator('input')
        item={'style':style,'computed':control.evaluate('(e)=>{const s=getComputedStyle(e);return {writingMode:s.writingMode,direction:s.direction,appearance:s.appearance,rect:e.getBoundingClientRect().toJSON()}}')}
        control.focus();page.keyboard.press('ArrowUp');item['up']=control.input_value()
        control.evaluate('e=>e.value=50');page.mouse.click(115,105);item['top']=control.input_value()
        control.evaluate('e=>e.value=50');page.mouse.click(115,335);item['bottom']=control.input_value()
        report['cases'].append(item)
    page.set_content('<style>input{appearance:none;width:30px;height:240px;writing-mode:vertical-lr;direction:rtl}input::-webkit-slider-runnable-track{width:6px;height:100%;background:gray}input::-webkit-slider-thumb{appearance:none;width:18px;height:20px;background:white}</style><input type="range">')
    report['customTrack']=page.locator('input').evaluate('e=>({writingMode:getComputedStyle(e).writingMode,appearance:getComputedStyle(e).appearance})')
    browser.close()
Path('reports/range-diagnostic.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
