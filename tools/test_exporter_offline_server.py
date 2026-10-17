"""Regression tests for service-worker fixture update delivery."""
from __future__ import annotations

import email.utils
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from exporter_offline_server import offline_fixture_handler, OfflineFixtureOrigin


class OfflineFixtureServerTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(); self.addCleanup(folder.cleanup)
        self.root = Path(folder.name); self.report = self.root / 'report'
        for release, body in [('one', b'worker-one'), ('two', b'worker-two')]:
            path = self.report / 'fixtures' / release / 'service-worker.js'
            path.parent.mkdir(parents=True); path.write_bytes(body)
        self.state = {'a': 'one', 'b': 'one', 'broken': 'one', 'failed': 'one',
                      'corrupt': False, 'api_available': True,
                      'api_requests': 0, 'worker_requests': 0}
        handler = offline_fixture_handler(self.root, self.report, self.state)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(handler, directory=str(self.root)))
        self.server.daemon_threads = True
        thread = threading.Thread(target=self.server.serve_forever, daemon=True); thread.start()
        self.addCleanup(self.server.server_close); self.addCleanup(self.server.shutdown)
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def request(self, path, headers=None):
        return urlopen(Request(self.base + path, headers=headers or {}), timeout=5)

    def test_changed_worker_bytes_ignore_conditional_mtime_revalidation(self):
        with self.request('/apps/a/service-worker.js') as response:
            self.assertEqual(response.read(), b'worker-one')
            self.assertEqual(response.status, 200)
            self.assertIn('no-store', response.headers['Cache-Control'])
        self.state['a'] = 'two'
        future = email.utils.formatdate(4102444800, usegmt=True)
        with self.request('/apps/a/service-worker.js', {'If-Modified-Since': future}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'worker-two')
        self.assertEqual(self.state['worker_requests'], 2)

    def test_origin_outage_closes_socket_and_restores_same_address(self):
        import socket
        handler = offline_fixture_handler(self.root, self.report, self.state)
        origin = OfflineFixtureOrigin(handler, self.root)
        self.addCleanup(origin.stop)
        url = origin.url + '/apps/a/service-worker.js'
        with urlopen(url, timeout=5) as response:
            self.assertEqual(response.read(), b'worker-one')
        origin.stop(); origin.stop()
        with self.assertRaises(OSError):
            socket.create_connection(origin.address, timeout=1)
        self.state['a'] = 'two'
        origin.start(); origin.start()
        with urlopen(url, timeout=5) as response:
            self.assertEqual(response.read(), b'worker-two')

    def test_dynamic_api_is_never_a_cached_shell_substitute(self):
        self.state['api_available'] = False
        with self.assertRaises(HTTPError) as failure:
            self.request('/apps/a/api/data')
        self.assertEqual(failure.exception.code, 503)
        self.assertEqual(failure.exception.read(), b'{"networkOnly":false}')
        self.assertEqual(self.state['api_requests'], 1)


if __name__ == '__main__':
    unittest.main()
