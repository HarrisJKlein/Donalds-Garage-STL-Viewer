"""Run with: python3 tests/browser-startup.py (requires Playwright and Chromium)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest
import struct

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def box_stl(x, y, z):
    vertices = [(a*x,b*y,c*z) for a,b,c in [(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)]]
    faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return b'unit-test'.ljust(80,b' ') + struct.pack('<I',12) + b''.join(struct.pack('<12fH',0,0,0,*vertices[a],*vertices[b],*vertices[c],0) for a,b,c in faces)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class StartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
            args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.page = self.browser.new_page()

    def tearDown(self):
        self.page.close()

    def load_model(self):
        expect(self.page.locator('#file-input')).to_be_enabled()
        self.page.locator('#file-input').set_input_files(str(ROOT / 'samples/garage-demo.stl'))
        expect(self.page.locator('#triangle-count')).to_have_text('7,320', timeout=30000)
        expect(self.page.locator('#status')).to_be_hidden()
        self.assertEqual(self.page.locator('#viewport canvas').count(), 1)

    def test_current_release_starts_and_loads_stl(self):
        self.page.goto(self.url, wait_until='networkidle')
        self.load_model()
        expect(self.page.locator('.printer-card img')).to_have_count(4)

    def test_previous_unversioned_cache_cannot_break_new_release(self):
        stale_requests = []
        def stale_module(route):
            stale_requests.append(route.request.url)
            # The previous release lacked the printerOrientation export.
            route.fulfill(status=200, content_type='text/javascript', body='''
                export const PRINTERS = [];
                export const printerFit = () => 'oriented';
                export const formatDimension = String;
                export const formatFileSize = String;
            ''')
        self.page.route('**/model-info.js', stale_module)
        self.page.goto(self.url, wait_until='networkidle')
        self.load_model()
        expect(self.page.locator('.printer-card img')).to_have_count(4)
        self.assertEqual(stale_requests, [])

    def test_missing_optional_preview_module_does_not_break_viewer(self):
        self.page.route('**/plate-previews.js*', lambda route: route.fulfill(status=404, body='Not found'))
        self.page.goto(self.url, wait_until='networkidle')
        self.load_model()
        expect(self.page.locator('.printer-card')).to_have_count(4)
        self.assertEqual(self.page.locator('.printer-card img').count(), 0)
        self.assertTrue(all('unavailable' in text for text in self.page.locator('.orientation-note').all_text_contents()))

    def test_missing_required_module_reports_loading_failure(self):
        self.page.route('**/model-info.js*', lambda route: route.fulfill(status=404, body='Not found'))
        self.page.goto(self.url, wait_until='networkidle')
        expect(self.page.locator('#status')).to_contain_text('could not load its files')
        self.assertNotIn('graphics acceleration', self.page.locator('#status').inner_text())
        expect(self.page.locator('#viewport-message')).to_be_visible()

    def test_unavailable_webgl_reports_graphics_failure(self):
        self.page.add_init_script('''
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                return type === 'webgl2' ? null : original.call(this, type, ...args);
            };
        ''')
        self.page.goto(self.url, wait_until='networkidle')
        expect(self.page.locator('#status')).to_contain_text('WebGL 2 graphics could not start')
        expect(self.page.locator('#status')).to_contain_text('graphics acceleration')
        expect(self.page.locator('#file-input')).to_be_disabled()

    def test_tiny_model_defaults_to_inches_and_allows_mm_override_and_print_height(self):
        self.page.goto(self.url, wait_until='networkidle')
        payload = {'name':'unit-test.stl','mimeType':'application/octet-stream','buffer':box_stl(0.61,0.61,1.537)}
        self.page.locator('#file-input').set_input_files(payload)
        expect(self.page.locator('#dimensions')).to_have_text('15.494 × 15.494 × 39.04 mm')
        expect(self.page.locator('#unit-select')).to_have_value('in')
        expect(self.page.locator('#unit-notice')).to_be_visible()
        expect(self.page.locator('#scale-percent')).to_have_value('100')
        self.page.locator('#unit-select').select_option('mm')
        expect(self.page.locator('#dimensions')).to_have_text('0.61 × 0.61 × 1.537 mm')
        expect(self.page.locator('#unit-notice')).to_be_hidden()
        expect(self.page.locator('#scale-warning')).to_be_visible()
        tiny_image = self.page.locator('.printer-card img').first.get_attribute('src')
        self.page.locator('#support-toggle').check()
        expect(self.page.locator('#support-status')).to_contain_text('No support layout could be estimated', timeout=30000)
        self.assertTrue(all('too small or thin' in text for text in self.page.locator('.support-caption').all_text_contents()))
        self.page.locator('#print-height').fill('150')
        self.page.locator('#print-height').press('Tab')
        expect(self.page.locator('#dimensions')).to_have_text('59.532 × 59.532 × 150 mm')
        expect(self.page.locator('#support-status')).to_contain_text('estimate ready for 4 of 4', timeout=30000)
        expect(self.page.locator('#scale-warning')).to_be_hidden()
        self.assertNotEqual(tiny_image, self.page.locator('.printer-card img').first.get_attribute('src'))
        expect(self.page.locator('#triangle-count')).to_have_text('12')
        expect(self.page.locator('#file-size')).to_have_text('684 bytes')
        # New files reset scale and apply the initial unit heuristic afresh.
        self.page.locator('#file-input').set_input_files(payload)
        expect(self.page.locator('#scale-percent')).to_have_value('100')
        expect(self.page.locator('#unit-select')).to_have_value('in')
        expect(self.page.locator('#dimensions')).to_have_text('15.494 × 15.494 × 39.04 mm')
        self.page.locator('#unit-select').select_option('m')
        expect(self.page.locator('#dimensions')).to_have_text('610 × 610 × 1,537 mm')
        self.assertEqual(self.page.locator('.fit-result').all_text_contents(), ['Exceeds checked bounds']*4)
        self.page.locator('#unit-select').select_option('mm')
        expect(self.page.locator('#support-status')).to_contain_text('No support layout could be estimated', timeout=30000)
        expect(self.page.locator('#dimensions')).to_have_text('0.61 × 0.61 × 1.537 mm')
        self.page.set_viewport_size({'width':375,'height':850})
        self.assertTrue(self.page.locator('html').evaluate('(e)=>e.scrollWidth<=innerWidth'))
        self.page.locator('#file-input').set_input_files({'name':'normal.stl','mimeType':'application/octet-stream','buffer':box_stl(60,60,20)})
        expect(self.page.locator('#unit-select')).to_have_value('mm')
        expect(self.page.locator('#dimensions')).to_have_text('60 × 60 × 20 mm')
        expect(self.page.locator('#unit-notice')).to_be_hidden()


if __name__ == '__main__':
    unittest.main(verbosity=2)
