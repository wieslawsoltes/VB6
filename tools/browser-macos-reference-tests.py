#!/usr/bin/env python3
"""Capture the real VB runtime against the AppKit atlas, preserving all pixels.

Portable runs provide browser/state/geometry coverage. --native-dir additionally
produces full native/browser diffs. --require-exact fails unless the complete
same-OS inventory is literally equal; normal comparison does not imply parity.
"""
from __future__ import annotations
import argparse
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import threading
from playwright.sync_api import sync_playwright
from PIL import Image
from macos_theme_compare import compare_directories, require_complete, require_exact, required_inventory

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get("VB6_BROWSER", "chromium")
MEMORY = os.environ.get("VB6_TEST_TRANSPORT") == "memory"

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def capture(destination: Path) -> dict:
    subprocess.run(["node", "tools/build-macos-theme-fixture.mjs"], cwd=ROOT, check=True)
    fixture_dir = ROOT / "reports/macos-theme-browser"
    fixture = json.loads((fixture_dir / "fixture.json").read_text())
    destination.mkdir(parents=True, exist_ok=True)
    report = {"schema": 1, "captures": [], "platform": platform.system(),
              "operatingSystemVersion": [int(v) for v in platform.mac_ver()[0].split(".")] if platform.system() == "Darwin" else None,
              "adaptationGaps": fixture["adaptationGaps"],
              "environment": {"engine": ENGINE, "transport": "memory" if MEMORY else "http", "authoredFont": "-apple-system", "sRGB": True},
              "sourceSHA256": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in ("dist/vb6-runtime.js", "dist/vb6-controls.css")}}
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"
    errors, external = [], []
    try:
        with sync_playwright() as pw:
            options = {}
            if ENGINE == "chromium":
                executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
                if executable:
                    options["executable_path"] = executable
                options["args"] = ["--no-sandbox", "--force-color-profile=srgb"]
            browser = getattr(pw, ENGINE).launch(**options)
            report["environment"]["browserVersion"] = browser.version
            try:
                for scale in (1, 2):
                    context = browser.new_context(viewport={"width": 1100, "height": 1000}, device_scale_factor=scale, locale="en-US", timezone_id="UTC")
                    context.on("page", lambda p: p.on("pageerror", lambda e: errors.append(str(e))))
                    context.on("request", lambda r: external.append(r.url) if r.url.startswith(("http:", "https:")) and not r.url.startswith(base) else None)
                    page = context.new_page()
                    try:
                        path = fixture_dir / "fixture.html"
                        if MEMORY:
                            page.set_content(path.read_text())
                        else:
                            page.goto(base + str(path.relative_to(ROOT)))
                        page.wait_for_function("typeof vb6Application==='object'")
                        page.evaluate("""() => {
                            window.referenceForm=vb6Application.forms[0];
                            window.referenceNodes=referenceForm.controls.map(c=>c.node);
                            const table=referenceForm.controls.find(c=>c.type==='ListView');
                            table.SelectedItem=table.ListItems.items[1];table.refresh();
                        }""")
                        page.mouse.move(1080, 980)
                        specimens = {v["name"]: v for v in fixture["specimens"]}
                        def shot(name, selector=None, frame=None):
                            filename = f"{name}-{scale}x.png"
                            if frame is not None:
                                rect = page.locator(".vb-form-content").bounding_box()
                                clip = {"x": rect["x"] + frame["x"], "y": rect["y"] + frame["y"], "width": frame["width"], "height": frame["height"]}
                                page.screenshot(path=str(destination / filename), clip=clip, scale="device")
                            else:
                                page.locator(selector).screenshot(path=str(destination / filename), scale="device")
                            with Image.open(destination / filename) as image:
                                pixels = list(image.size)
                            expected = [round(frame["width"] * scale), round(frame["height"] * scale)] if frame else pixels
                            assert pixels == expected, (name, pixels, expected)
                            report["captures"].append({"name": name, "scale": scale, "pixels": pixels, "file": filename})
                        def control_shot(name, specimen):
                            shot(name, frame=specimen["frame"])
                        for scheme in ("light", "dark"):
                            theme = "macos26" + ("-dark" if scheme == "dark" else "")
                            page.emulate_media(color_scheme=scheme, reduced_motion="reduce")
                            page.evaluate("theme=>vb6Application.setTheme(theme,{reduceMotion:true})", theme)
                            page.wait_for_timeout(150)
                            assert page.evaluate("referenceNodes.every((n,i)=>referenceForm.controls[i].node===n)")
                            # Normal drawing: no pointer or transient focus adornment.
                            page.evaluate("document.activeElement?.blur()")
                            shot(scheme + "-gallery", ".vb-form-content")
                            for specimen in specimens.values():
                                control_shot(scheme + "-" + specimen["name"], specimen)
                            for name in ("default-button", "secondary-button"):
                                spec = specimens[name]
                                button = page.locator(f'[data-control="{spec["control"]}"]')
                                button.hover(); page.mouse.down(); page.wait_for_timeout(120)
                                control_shot(scheme + "-" + name.replace("-button", "-pressed"), spec)
                                page.mouse.move(1080, 980); page.mouse.up()
                            # Real property updates, not replacement markup or screenshot-only styles.
                            for name in ("default-button", "check-off", "check-on", "check-mixed", "radio-on", "text-field", "combo-box", "popup-button", "slider", "stepper"):
                                spec = specimens[name]
                                page.evaluate("name=>{const c=referenceForm.controls.find(c=>c.model.name===name);c.set('Enabled',0);c.refresh();}", spec["control"])
                                state = "default-disabled" if name == "default-button" else name + "-disabled"
                                control_shot(scheme + "-" + state, spec)
                                page.evaluate("name=>{const c=referenceForm.controls.find(c=>c.model.name===name);c.set('Enabled',-1);c.refresh();}", spec["control"])
                            # Frame comparison intentionally keeps the public VB6 client geometry.
                            # A native/browser non-client size difference is reported, never resized away.
                            page.evaluate("()=>{referenceForm.props.BorderStyle=2;referenceForm.refresh();}")
                            shot(scheme + "-window", ".vb-form")
                            page.evaluate("()=>{referenceForm.node.classList.add('vb-inactive');document.activeElement?.blur();}")
                            shot(scheme + "-inactive-window", ".vb-form")
                            page.evaluate("()=>{referenceForm.props.BorderStyle=0;referenceForm.refresh();}")
                            shot(scheme + "-inactive-gallery", ".vb-form-content")
                            for specimen in specimens.values():
                                control_shot(scheme + "-inactive-" + specimen["name"], specimen)
                            page.evaluate("referenceForm.node.classList.remove('vb-inactive')")
                        assert page.evaluate("referenceNodes.every((n,i)=>referenceForm.controls[i].node===n)")
                        assert not errors, errors
                        assert not external, external
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close()
        report["pageErrors"] = errors; report["externalRequests"] = external
        (destination / "captures.json").write_text(json.dumps(report, indent=2) + "\n")
    assert {(v["name"],v["scale"]) for v in report["captures"]} == required_inventory(), "Incomplete runtime state inventory"
    print(f"Captured {len(report['captures'])} actual runtime images ({ENGINE}, {'memory' if MEMORY else 'HTTP'}); no native equality inferred")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-dir", type=Path)
    parser.add_argument("--require-exact", action="store_true")
    args = parser.parse_args()
    if args.require_exact and args.native_dir is None:
        parser.error("--require-exact requires --native-dir")
    destination = ROOT / "reports/macos-theme-browser" / ENGINE
    capture(destination)
    if args.native_dir is not None:
        result = compare_directories(args.native_dir, destination, destination / "native-differences")
        print(f"Unmasked native comparisons: {result['exactCaptureCount']}/{result['nativeCaptureCount']} exact; nativePixelParityCertified={result['nativePixelParityCertified']}")
        require_complete(result)
        if args.require_exact:
            require_exact(result)

if __name__ == "__main__":
    main()
