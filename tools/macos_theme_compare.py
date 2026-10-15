"""Unmasked native/browser RGBA comparison. No registration, resizing or tolerance.

Native view PNGs retain alpha. Both images are composited onto the captured
window's sRGB background before comparing the visible RGB channels. The original
PNG hashes and alpha differences remain in the report. A successful invocation
means the comparison ran; only require_exact() certifies its complete inventory.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from typing import Any
from PIL import Image, ImageChops, ImageStat


SPECIMENS = ('default-button','secondary-button','disabled-button','check-off','check-on','check-mixed','radio-on',
             'text-field','combo-box','popup-button','segmented-control','slider','progress','date-picker','search-field',
             'group-box','rich-text','table-view','tab-view','separator','stepper')
DISABLED = ('check-off','check-on','check-mixed','radio-on','text-field','combo-box','popup-button','slider','stepper')

def required_inventory() -> set[tuple[str,int]]:
    names = (*SPECIMENS, 'gallery', 'window', 'default-pressed', 'secondary-pressed', 'default-disabled',
             *(name+'-disabled' for name in DISABLED), 'inactive-gallery', 'inactive-window',
             *('inactive-'+name for name in SPECIMENS))
    return {(scheme+'-'+name, scale) for scheme in ('light','dark') for scale in (1,2) for name in names}


def read_manifest(directory: Path, name: str) -> dict[str, Any]:
    path = directory / name
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema") != 1 or not isinstance(value.get("captures"), list):
        raise ValueError(f"Invalid capture manifest: {path}")
    keys = set()
    for capture in value["captures"]:
        if not isinstance(capture, dict):
            raise ValueError("Each capture must be an object")
        key = (capture.get("name"), capture.get("scale"))
        if not isinstance(key[0], str) or type(key[1]) is not int or key[1] not in (1, 2) or key in keys:
            raise ValueError(f"Missing/duplicate/invalid capture identity: {key}")
        keys.add(key)
        image_path(directory, capture.get("file"))
    return value


def image_path(directory: Path, filename: Any) -> Path:
    if not isinstance(filename, str) or not filename.endswith(".png") or Path(filename).name != filename or "\\" in filename:
        raise ValueError(f"Invalid image filename: {filename!r}")
    path = directory / filename
    if path.is_symlink() or not path.is_file() or path.resolve().parent != directory.resolve():
        raise ValueError(f"Missing or non-local capture: {filename}")
    return path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare_image(native: Path, browser: Path, background: tuple[int, int, int], diff_path: Path) -> dict[str, Any]:
    with Image.open(native) as source:
        a = source.convert("RGBA")
    with Image.open(browser) as source:
        b = source.convert("RGBA")
    result = {"nativeSHA256": digest(native), "browserSHA256": digest(browser),
              "nativeSize": list(a.size), "browserSize": list(b.size), "equal": False}
    if a.size != b.size:
        result["reason"] = "dimension-mismatch; no resampling or registration performed"
        return result
    def visible(image: Image.Image) -> Image.Image:
        surface = Image.new("RGBA", image.size, (*background, 255))
        surface.alpha_composite(image)
        return surface.convert("RGB")
    delta = ImageChops.difference(visible(a), visible(b))
    # max(R,G,B) counts all nonzero differences, including one-channel/one-level
    # antialiasing changes. Luminance conversion would incorrectly discard some.
    r, g, blue = delta.split()
    maximum = ImageChops.lighter(ImageChops.lighter(r, g), blue)
    changed = a.width * a.height - maximum.histogram()[0]
    result.update({"equal": changed == 0, "pixels": a.width * a.height,
                   "changedPixels": changed, "changedFraction": changed / (a.width * a.height),
                   "meanAbsoluteRGBError": sum(ImageStat.Stat(delta).mean) / 3,
                   "maxChannelError": max(channel[1] for channel in delta.getextrema()),
                   "alphaChangedPixels": a.width * a.height - ImageChops.difference(a.getchannel("A"), b.getchannel("A")).histogram()[0]})
    diff_path.parent.mkdir(parents=True, exist_ok=True)
    delta.save(diff_path)
    result["differenceFile"] = diff_path.name
    return result


def compare_directories(native_dir: Path, browser_dir: Path, output_dir: Path) -> dict[str, Any]:
    native = read_manifest(native_dir, "reference.json")
    browser = read_manifest(browser_dir, "captures.json")
    environment = native.get("environment", [])
    if {v.get("scheme") for v in environment} != {"light", "dark"} or any(not v.get("applicationActive") or not v.get("keyWindow") for v in environment):
        raise ValueError("Native baseline must contain active, key light and dark windows")
    if native.get("operatingSystemVersion", [0])[0] != 26:
        raise ValueError("A macOS 26 native reference is required")
    lookup = {(v["name"], v["scale"]): v for v in browser["captures"]}
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for reference in native["captures"]:
        name, scale = reference["name"], reference["scale"]
        entry = {"name": name, "scale": scale, "equal": False}
        counterpart = lookup.get((name, scale))
        if counterpart is None:
            entry["reason"] = "missing-browser-counterpart"
        else:
            scheme = name.split("-", 1)[0]
            rgba = native["colorsSRGB"][scheme]["windowBackground"]
            if len(rgba) != 4 or rgba[3] != 1:
                raise ValueError("Opaque sRGB native window background required")
            background = tuple(round(v * 255) for v in rgba[:3])
            entry.update(compare_image(image_path(native_dir, reference["file"]),
                                       image_path(browser_dir, counterpart["file"]), background,
                                       output_dir / f"{name}-{scale}x-diff.png"))
            # Declared dimensions are independently checked; successful PNG decode
            # alone must not permit a truncated/cropped capture to count as exact.
            if entry.get("nativeSize") != reference.get("pixels") or entry.get("browserSize") != counterpart.get("pixels"):
                raise ValueError(f"Manifest/PNG dimensions disagree for {name} at {scale}x")
        results.append(entry)
    source_inventory = {(v["name"], v["scale"]) for v in native["captures"]}
    extra = sorted(set(lookup) - source_inventory)
    same_os = browser.get("operatingSystemVersion") == native.get("operatingSystemVersion") and browser.get("platform") == "Darwin"
    report = {"schema": 1, "comparisonExecuted": True, "pixelTolerance": 0,
              "alignment": "none", "resampling": "none", "glyphMasks": False,
              "nativeOS": native.get("os"), "browserEnvironment": browser.get("environment"),
              "sameOperatingSystem": same_os, "nativeCaptureCount": len(results),
              "exactCaptureCount": sum(v["equal"] for v in results), "extraBrowserCaptures": extra,
              "adaptationGaps": browser.get("adaptationGaps", []), "results": results}
    # Even identical but partial/empty/test-produced inventories cannot certify
    # the supplied platform target. Compare every native view/state and both DPRs.
    inventory_complete = required_inventory() <= source_inventory and required_inventory() <= set(lookup)
    report["missingRequiredNativeStates"] = sorted(required_inventory() - source_inventory)
    report["missingRequiredBrowserStates"] = sorted(required_inventory() - set(lookup))
    inactive = native.get("inactiveEnvironment", [])
    inactive_verified = (len(inactive) == 4 and {(v.get("scheme"), v.get("scale")) for v in inactive}
                         == {(s,d) for s in ("light","dark") for d in (1,2)}
                         and all(v.get("keyWindow") is False and v.get("otherWindowIsKey") is True
                                 and v.get("applicationActive") is True for v in inactive))
    report["inactiveTransitionsVerified"] = inactive_verified
    report["certificationScope"] = "Captured control/view states only; excludes WindowServer refraction, outside shadows and other platform components"
    browser_clean = browser.get("pageErrors") == [] and browser.get("externalRequests") == []
    report["nativePixelParityCertified"] = (same_os and inventory_complete and inactive_verified and browser_clean and not report["adaptationGaps"]
                                           and all(v["equal"] for v in results))
    (output_dir / "comparison.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def require_exact(report: dict[str, Any]) -> None:
    if report.get("nativePixelParityCertified") is not True:
        raise AssertionError(f"Native pixel parity NOT established: {report.get('exactCaptureCount', 0)}/{report.get('nativeCaptureCount', 0)} exact captures")


def require_complete(report: dict[str, Any]) -> None:
    """Coverage is mandatory even when pixel equality remains unestablished."""
    if (report.get("missingRequiredNativeStates") != [] or report.get("missingRequiredBrowserStates") != []
            or report.get("inactiveTransitionsVerified") is not True
            or report.get("nativeCaptureCount", 0) < len(required_inventory())):
        raise AssertionError("Incomplete native/browser state inventory or unverified key-window transitions")
