"""Regression tests for the zero-tolerance, no-alignment native comparator."""
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from macos_theme_compare import compare_image, compare_directories, image_path, read_manifest, require_complete, require_exact, required_inventory


class ComparisonTests(unittest.TestCase):
    def test_coverage_gate_does_not_confuse_mismatches_with_missing_states(self):
        report={'missingRequiredNativeStates':[], 'missingRequiredBrowserStates':[],
                'inactiveTransitionsVerified':True, 'nativeCaptureCount':len(required_inventory()),
                'nativePixelParityCertified':False}
        require_complete(report)
        with self.assertRaises(AssertionError):require_exact(report)
        for key,value in [('missingRequiredNativeStates',[['light-window',1]]),
                          ('missingRequiredBrowserStates',[['dark-window',2]]),
                          ('inactiveTransitionsVerified',False),('nativeCaptureCount',0)]:
            with self.assertRaises(AssertionError):require_complete({**report,key:value})
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.native = self.root / 'native'; self.native.mkdir()
        self.browser = self.root / 'browser'; self.browser.mkdir()
        self.output = self.root / 'differences'
    def tearDown(self):
        self.temp.cleanup()
    def png(self, directory, name='sample.png', color=(16, 32, 48, 255), size=(4, 4)):
        path = directory / name
        Image.new('RGBA', size, color).save(path)
        return path
    def compare(self, a, b):
        return compare_image(a, b, (255, 255, 255), self.output / 'sample.png')
    def manifests(self, captures=None, browser_captures=None, gaps=None, platform='Darwin', version=None):
        captures = captures if captures is not None else [{'name':'light-default-button', 'scale':1, 'file':'sample.png', 'pixels':[4,4]}]
        native = {'schema':1, 'captures':captures, 'operatingSystemVersion':[26,6,2], 'os':'26.6.2',
                  'environment':[{'scheme':s, 'keyWindow':True, 'applicationActive':True} for s in ['light','dark']],
                  'inactiveEnvironment':[{'scheme':s, 'scale':d, 'keyWindow':False, 'applicationActive':True, 'otherWindowIsKey':True} for s in ['light','dark'] for d in [1,2]],
                  'colorsSRGB':{s:{'windowBackground':[1,1,1,1]} for s in ['light','dark']}}
        browser = {'schema':1, 'captures':captures if browser_captures is None else browser_captures,
                   'platform':platform, 'operatingSystemVersion':version or [26,6,2], 'adaptationGaps':gaps or [],
                   'pageErrors':[], 'externalRequests':[], 'environment':{'transport':'http', 'sRGB':True}}
        (self.native/'reference.json').write_text(json.dumps(native)); (self.browser/'captures.json').write_text(json.dumps(browser))
        return native, browser
    def run_comparison(self):
        return compare_directories(self.native, self.browser, self.output)
    def test_equal_visible_pixels(self):
        result = self.compare(self.png(self.native), self.png(self.browser))
        self.assertTrue(result['equal']); self.assertEqual(result['changedPixels'], 0)
        self.assertEqual(result['maxChannelError'], 0)
    def test_single_blue_channel_single_level_difference_is_not_rounded_away(self):
        a=self.png(self.native); b=self.png(self.browser)
        with Image.open(b) as image:
            image.putpixel((3,3),(16,32,49,255)); image.save(b)
        result=self.compare(a,b)
        self.assertFalse(result['equal']); self.assertEqual(result['changedPixels'],1)
        self.assertEqual(result['maxChannelError'],1)
    def test_no_resampling_dimension_mismatch(self):
        result=self.compare(self.png(self.native),self.png(self.browser,size=(5,4)))
        self.assertFalse(result['equal']); self.assertIn('dimension-mismatch',result['reason'])
        self.assertNotIn('changedFraction',result)
    def test_visible_compositing_preserves_raw_alpha_evidence(self):
        a=self.png(self.native,color=(0,0,0,20));b=self.png(self.browser,color=(235,235,235,255))
        result=self.compare(a,b)
        self.assertTrue(result['equal']);self.assertEqual(result['alphaChangedPixels'],16)
        self.assertNotEqual(result['nativeSHA256'],result['browserSHA256'])
    def test_path_traversal_absolute_files_and_wrong_type_rejected(self):
        for name in ['../sample.png','/sample.png','a\\sample.png','sample.jpg',None]:
            with self.subTest(name=name),self.assertRaises(ValueError):image_path(self.native,name)
    def test_symlink_rejected(self):
        target=self.png(self.browser);(self.native/'sample.png').symlink_to(target)
        with self.assertRaises(ValueError):image_path(self.native,'sample.png')
    def test_duplicate_inventory_rejected(self):
        self.png(self.native);self.png(self.browser);native,_=self.manifests()
        native['captures']*=2;(self.native/'reference.json').write_text(json.dumps(native))
        with self.assertRaises(ValueError):read_manifest(self.native,'reference.json')
    def test_partial_and_empty_inventories_never_certify(self):
        self.png(self.native);self.png(self.browser)
        for captures in [None,[]]:
            self.manifests(captures=captures);result=self.run_comparison()
            self.assertFalse(result['nativePixelParityCertified'])
            with self.assertRaises(AssertionError):require_exact(result)
    def test_missing_counterpart_is_a_failure_not_a_skip(self):
        self.png(self.native);self.manifests(browser_captures=[]);result=self.run_comparison()
        self.assertEqual(result['results'][0]['reason'],'missing-browser-counterpart')
        self.assertFalse(result['nativePixelParityCertified'])
    def test_declared_dimensions_must_match_file(self):
        self.png(self.native);self.png(self.browser);native,_=self.manifests()
        native['captures'][0]['pixels']=[2,2];(self.native/'reference.json').write_text(json.dumps(native))
        with self.assertRaises(ValueError):self.run_comparison()
    def test_inactive_reference_cannot_be_the_active_baseline(self):
        self.png(self.native);self.png(self.browser);native,_=self.manifests()
        native['environment'][0]['keyWindow']=False;(self.native/'reference.json').write_text(json.dumps(native))
        with self.assertRaises(ValueError):self.run_comparison()
    def test_complete_inventory_requires_correct_os_no_gaps_and_clean_browser(self):
        captures=[]
        for name,scale in sorted(required_inventory()):
            file=f'{name}-{scale}x.png';size=(4*scale,4*scale)
            self.png(self.native,file,size=size);self.png(self.browser,file,size=size)
            captures.append({'name':name,'scale':scale,'file':file,'pixels':list(size)})
        native,browser=self.manifests(captures=captures)
        result=self.run_comparison();self.assertTrue(result['nativePixelParityCertified']);require_exact(result)
        for key,value in [('platform','Linux'),('operatingSystemVersion',[26,6,1]),('adaptationGaps',['native picker']),('pageErrors',['uncaught'])]:
            with self.subTest(key=key):
                changed={**browser,key:value};(self.browser/'captures.json').write_text(json.dumps(changed))
                self.assertFalse(self.run_comparison()['nativePixelParityCertified'])
        (self.browser/'captures.json').write_text(json.dumps(browser))
        # A same-sized substitute of a missing mandatory state must not count as complete.
        native['captures'][-1]['name']='light-made-up-control';(self.native/'reference.json').write_text(json.dumps(native))
        self.assertFalse(self.run_comparison()['nativePixelParityCertified'])

if __name__=='__main__':unittest.main()
