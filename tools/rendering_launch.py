"""One software-GPU launch profile shared by rendering acceptance runners."""
from __future__ import annotations

import os
import shlex
from collections.abc import Mapping, Sequence

SOFTWARE_GPU_FLAGS = (
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--disable-partial-raster',
    '--run-all-compositor-stages-before-draw',
)


def rendering_launch_flags(*, software_gpu: bool = False,
                           environ: Mapping[str, str] | None = None,
                           base: Sequence[str] = ('--no-sandbox',)) -> list[str]:
    """Return the exact audited browser flags for a rendering test process."""
    environment = os.environ if environ is None else environ
    flags = [*base]
    if software_gpu:
        flags.extend(SOFTWARE_GPU_FLAGS)
    flags.extend(shlex.split(environment.get('RENDERING_BROWSER_FLAGS', '')))
    if any(not isinstance(flag, str) or not flag or '\x00' in flag for flag in flags):
        raise ValueError('Invalid rendering browser flag')
    feature_switch = '--enable-features='
    feature_overrides = [flag for flag in flags if flag.startswith(feature_switch)]
    if feature_overrides:
        # Playwright 1.63 enables this capture mode before appending our flags.
        # Chromium keeps only the last duplicate switch, so an explicit Vulkan
        # feature list otherwise disables the fix for ForceRedraw capture stalls.
        # https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.12/content/common/features.cc#153
        # https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.12/base/command_line.cc#449
        features = [] if environment.get('PLAYWRIGHT_LEGACY_SCREENSHOT') else ['CDPScreenshotNewSurface']
        features.extend(feature for flag in feature_overrides
                        for feature in flag[len(feature_switch):].split(',') if feature)
        flags = [flag for flag in flags if not flag.startswith(feature_switch)]
        flags.append(feature_switch + ','.join(dict.fromkeys(features)))
    return flags
