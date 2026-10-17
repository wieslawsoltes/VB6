"""Regression tests for the shared software-GPU browser profile."""
import unittest

from rendering_launch import SOFTWARE_GPU_FLAGS, rendering_launch_flags


class RenderingLaunchTests(unittest.TestCase):
    def test_default_profile_is_minimal(self):
        self.assertEqual(rendering_launch_flags(environ={}), ['--no-sandbox'])

    def test_software_profile_is_complete_and_stable(self):
        flags = rendering_launch_flags(software_gpu=True, environ={})
        self.assertEqual(flags, ['--no-sandbox', *SOFTWARE_GPU_FLAGS])
        for required in ('--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
                         '--use-angle=swiftshader', '--use-vulkan=swiftshader'):
            self.assertIn(required, flags)

    def test_workflow_flags_are_shell_parsed_once(self):
        flags = rendering_launch_flags(
            software_gpu=True,
            environ={'RENDERING_BROWSER_FLAGS': '--enable-gpu "--feature=Vulkan SwiftShader"'},
            base=('--no-sandbox', '--disable-dev-shm-usage'))
        self.assertEqual(flags[-2:], ['--enable-gpu', '--feature=Vulkan SwiftShader'])
        self.assertEqual(flags[:2], ['--no-sandbox', '--disable-dev-shm-usage'])

    def test_gpu_feature_override_preserves_playwright_screenshot_capture(self):
        flags = rendering_launch_flags(
            software_gpu=True,
            environ={'RENDERING_BROWSER_FLAGS': '--enable-gpu --enable-features=Vulkan --disable-gpu-rasterization'})
        # Playwright appends our arguments after its own defaults. Chromium uses
        # the final value for duplicate switches, so inspect that effective value.
        command_line = ['--enable-features=CDPScreenshotNewSurface', *flags]
        switches = dict(flag.split('=', 1) for flag in command_line if '=' in flag)
        self.assertEqual(set(switches['--enable-features'].split(',')),
                         {'CDPScreenshotNewSurface', 'Vulkan'})
        self.assertIn('--enable-gpu', flags)
        self.assertIn('--disable-gpu-rasterization', flags)
        for required in SOFTWARE_GPU_FLAGS:
            self.assertIn(required, flags)

    def test_feature_overrides_merge_without_losing_parameters_or_duplicates(self):
        flags = rendering_launch_flags(
            base=('--no-sandbox', '--enable-features=Vulkan'),
            environ={'RENDERING_BROWSER_FLAGS': '--enable-features=FeatureA<Trial:mode/fast,Vulkan --enable-features=CDPScreenshotNewSurface,FeatureB'})
        enabled = [flag for flag in flags if flag.startswith('--enable-features=')]
        self.assertEqual(len(enabled), 1)
        features = enabled[0].split('=', 1)[1].split(',')
        self.assertEqual(set(features),
                         {'CDPScreenshotNewSurface', 'Vulkan', 'FeatureA<Trial:mode/fast', 'FeatureB'})
        self.assertEqual(len(features), 4)

    def test_explicit_playwright_legacy_capture_diagnostic_is_respected(self):
        flags = rendering_launch_flags(environ={
            'PLAYWRIGHT_LEGACY_SCREENSHOT': '1',
            'RENDERING_BROWSER_FLAGS': '--enable-features=Vulkan'})
        self.assertIn('--enable-features=Vulkan', flags)
        self.assertFalse(any('CDPScreenshotNewSurface' in flag for flag in flags))

    def test_invalid_flags_fail_closed(self):
        with self.assertRaises(ValueError):
            rendering_launch_flags(environ={'RENDERING_BROWSER_FLAGS': '""'})


if __name__ == '__main__':
    unittest.main()
