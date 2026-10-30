"""COM/OLE contracts against ESM and the built runtime in each supported browser."""
import functools
import http.server
import json
import os
from pathlib import Path
import threading
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BROWSER = os.environ.get("VB6_BROWSER", "chromium")
if BROWSER not in {"chromium", "firefox", "webkit"}:
    raise ValueError("Unknown VB6_BROWSER")

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

report = {"browser": BROWSER, "status": "failed", "modes": {}}
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as playwright:
        launch = {"headless": True}
        if BROWSER == "chromium" and os.environ.get("CHROMIUM_PATH"):
            launch["executable_path"] = os.environ["CHROMIUM_PATH"]
        browser = getattr(playwright, BROWSER).launch(**launch)
        try:
            for mode in ("esm", "bundle"):
                page = browser.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    page.goto(f"http://127.0.0.1:{server.server_port}/tests/fixtures/com-ole-browser.html")
                    if mode == "bundle":
                        page.add_script_tag(url="/dist/vb6-runtime.js")
                    checks = page.evaluate("""async mode => {
                        const api = mode === 'esm' ? (await import('/src/runtime/entry.js')).RuntimeAPI : globalThis.VB6Runtime.RuntimeAPI;
                        const {validateComOleBrowser} = await import('/tests/fixtures/com-ole-browser.js');
                        return await validateComOleBrowser(api);
                    }""", mode)
                    assert len(checks) == 26, checks
                    assert not errors, errors
                    report["modes"][mode] = checks
                finally:
                    page.close()
            report["standalone"] = {}
            for origin in ("http", "file"):
                page = browser.new_page(accept_downloads=True)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    url = f"http://127.0.0.1:{server.server_port}/dist/examples/ole-documents.html" if origin == "http" else (ROOT / "dist/examples/ole-documents.html").as_uri()
                    page.goto(url)
                    page.wait_for_function("globalThis.vb6Application?.forms?.[0]?.controlMap.get('document1')?.Object.Text.includes('OLE documents are ready.')")
                    page.locator('[data-control="cmdText"]').click()
                    editor = page.locator('[data-control="Document1"] textarea')
                    editor.fill("A document saved from the real browser.")
                    page.locator('[data-control="cmdSave"]').click()
                    page.wait_for_function("vb6Application.fs.exists('/saved-document.dat') && vb6Application.fs.read('/saved-document.dat') === 'A document saved from the real browser.'")
                    with page.expect_download() as pending:
                        page.locator('[data-control="cmdExport"]').click()
                    assert Path(pending.value.path()).read_bytes() == b"A document saved from the real browser."
                    payload = bytes([0, 1, 255, 128, 60, 115, 99, 114, 105, 112, 116, 62])
                    with page.expect_file_chooser() as pending:
                        page.locator('[data-control="cmdInsert"]').click()
                    pending.value.set_files({"name": "package.bin", "mimeType": "application/octet-stream", "buffer": payload})
                    page.wait_for_function("vb6Application.forms[0].controlMap.get('document1').Class === 'Package'")
                    with page.expect_download() as pending:
                        page.locator('[data-control="cmdExport"]').click()
                    assert Path(pending.value.path()).read_bytes() == payload
                    page.locator('[data-control="cmdLink"]').click()
                    page.locator('[data-control="Document1"] textarea').fill("Edited linked document")
                    page.get_by_role("button", name="Document actions", exact=True).click()
                    page.get_by_role("menuitem", name="Save to source", exact=True).click()
                    page.wait_for_function("vb6Application.fs.read('/note.txt') === 'Edited linked document'")
                    page.locator('[data-control="cmdRich"]').click()
                    rich = page.locator('[data-control="Document1"] [contenteditable="true"]')
                    rich.click()
                    page.keyboard.insert_text("Rich text ")
                    page.keyboard.press("Control+b")
                    page.keyboard.insert_text("bold")
                    assert page.evaluate("vb6Application.forms[0].controlMap.get('document1').Object.Text") == "Rich text bold"
                    with page.expect_download() as pending:
                        page.locator('[data-control="cmdExport"]').click()
                    rtf = Path(pending.value.path()).read_bytes()
                    assert rtf.startswith(b"{\\rtf1") and b"bold" in rtf and b"\\b1" in rtf, rtf
                    assert not errors, errors
                    if origin == "http":
                        screenshot = ROOT / "reports" / "com-ole" / BROWSER / "ole-workbench.png"
                        screenshot.parent.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(screenshot))
                    report["standalone"][origin] = ["startup VB6 Object automation", "text editing and private-disk save", "real text download", "real binary import/export", "linked-source menu save", "rich-text keyboard formatting and download"]
                finally:
                    page.close()
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            try:
                page.goto(f"http://127.0.0.1:{server.server_port}/dist/index.html")
                page.wait_for_function("typeof vb6Studio === 'object' && !!document.querySelector('.ide-shell')", timeout=60000)
                page.evaluate("""async () => {
                    const {newProject,createControl}=await import('/src/project/model.js');
                    const project=newProject('OLEDesigner'),control=createControl('OLE','Document1');
                    project.modules[0].code='Option Explicit';project.modules[0].form.controls=[control];
                    vb6Studio.loadProject(project);vb6Studio.designer.select([control.id]);
                    window.olePropertyResult=vb6Studio.showControlPropertyPages();
                }""")
                dialog = page.get_by_role("dialog", name="OLE Document - Document1", exact=True)
                dialog.get_by_role("button", name="New text", exact=True).click()
                dialog.get_by_role("textbox", name="OLE document preview", exact=True).fill("Authored embedded document")
                dialog.get_by_role("button", name="OK", exact=True).click()
                assert page.evaluate("olePropertyResult") is True
                snapshot = page.evaluate("vb6Studio.activeModule.form.controls[0].properties.OLEDocument")
                assert snapshot["format"] == "VB6.OLE.Document"
                assert page.locator('.designer [data-control="Document1"] textarea').count() or page.locator('[data-control="Document1"] textarea').count()
                page.evaluate("window.olePropertyResult=vb6Studio.showControlPropertyPages(); void 0")
                dialog = page.get_by_role("dialog", name="OLE Document - Document1", exact=True)
                assert dialog.get_by_role("textbox", name="OLE document preview", exact=True).input_value() == "Authored embedded document"
                dialog.get_by_role("textbox", name="OLE document preview", exact=True).fill("Cancelled edit")
                dialog.get_by_role("button", name="Cancel", exact=True).click()
                assert page.evaluate("olePropertyResult") is False
                assert page.evaluate("vb6Studio.activeModule.form.controls[0].properties.OLEDocument") == snapshot
                assert not errors, errors
                report["designer"] = ["property pages commit one embedded draft", "designer renders persisted content", "reopen preserves content and Cancel preserves model"]
            finally:
                page.close()
        finally:
            browser.close()
    report["status"] = "passed"
except Exception:
    report["error"] = traceback.format_exc()
    raise
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    output = ROOT / "reports" / "com-ole" / BROWSER
    output.mkdir(parents=True, exist_ok=True)
    (output / "contracts.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
