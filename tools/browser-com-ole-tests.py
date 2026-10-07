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
        browser = getattr(playwright, BROWSER).launch(headless=True)
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
                    assert len(checks) == 9, checks
                    assert not errors, errors
                    report["modes"][mode] = checks
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
