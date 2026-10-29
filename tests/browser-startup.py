"""Run with: python3 tests/browser-startup.py (requires Playwright and Chromium)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


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


if __name__ == '__main__':
    unittest.main(verbosity=2)
