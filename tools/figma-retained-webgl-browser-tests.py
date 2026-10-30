#!/usr/bin/env python3
"""Retained WebGL must publish each workspace transaction without an idle loop.
Uses unmodified screenshot assertions; never redraws or reads GPU pixels to pass.
"""
import importlib.util
import json
import unittest
from pathlib import Path
from ci.browser_partition import configured_shard, select_case_names
spec=importlib.util.spec_from_file_location('figma_presentation',Path(__file__).with_name('figma-presentation-browser-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
REPORT=base.REPORT.parent/'retained-webgl'
base.REPORT=REPORT
base.base.REPORT=REPORT

class RetainedWebGL(base.FigmaPresentation):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if base.base.ENGINE=='chromium':
            # The authoring harness intentionally disables GPU. This separate
            # renderer qualification uses an explicitly labelled software GL.
            cls.browser.close()
            options={'headless':True,'args':['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}
            executable=base.base.os.environ.get('CHROMIUM_PATH') or base.base.shutil.which('chromium')
            if executable:options['executable_path']=executable
            cls.browser=cls.pw.chromium.launch(**options)
        elif base.base.ENGINE=='firefox':
            # Firefox headless on the Linux runner has no WebGL context. Use a
            # real headed session under Xvfb with Mesa software GL for this
            # required-API case only; ordinary authoring stays headless.
            # https://playwright.dev/python/docs/ci#running-headed
            cls.browser.close()
            cls.browser=cls.pw.firefox.launch(headless=False,
                env={**base.base.os.environ,'LIBGL_ALWAYS_SOFTWARE':'1'},
                firefox_user_prefs={'webgl.force-enabled':True})

    def test_retained_webgl_buffer_and_idle(self):
        self.page.evaluate('vb6Studio.setRenderingPolicy({backend:"webgl2",fallbacks:["html"],text:"native"})')
        stats=self.page.evaluate('vb6Studio.rendering.getStats()')
        (REPORT/'startup.json').write_text(json.dumps({'engine':base.base.ENGINE,
            'display':'headed' if base.base.ENGINE=='firefox' else 'headless',
            'softwareRenderingRequested':base.base.ENGINE in ['chromium','firefox'],
            'renderer':stats},indent=2))
        self.assertEqual(stats['active'],'webgl2')
        self.assertTrue(self.page.evaluate('vb6Studio.rendering.driver.gl.getContextAttributes().preserveDrawingBuffer'))
        self.enable(True);self.select(['frame']);before=self.snapshot()
        self.page.evaluate('window.testFigmaDriver=vb6Studio.rendering.driver')
        for index,scheme in enumerate(['dark','light']*4):
            self.page.evaluate('scheme=>vb6Studio.figmaMode.configure({mode:"figma",scheme,units:"px"})',scheme)
            self.painted_theme(scheme,'retained-webgl-'+str(index)+'-'+scheme,'webgl2')
            self.assertEqual(self.snapshot(),before)
            self.assertTrue(self.page.evaluate('window.testFigmaDriver===vb6Studio.rendering.driver'))
        self.page.wait_for_timeout(350)
        frames=self.page.evaluate('vb6Studio.rendering.metrics.frames')
        self.page.wait_for_timeout(300)
        self.assertEqual(self.page.evaluate('vb6Studio.rendering.metrics.frames'),frames)
        self.done()


def load_tests(loader,standard_tests,pattern):
    names=select_case_names(['test_retained_webgl_buffer_and_idle'],configured_shard('figma-authoring'))
    return unittest.TestSuite(RetainedWebGL(name) for name in names)

if __name__=='__main__':unittest.main(verbosity=2)
