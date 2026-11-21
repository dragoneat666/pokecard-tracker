"""Tests for fetch.py's strip handling, against a fake backend on localhost
(nothing is sent to the real server).

Run:  E:\\pokecard-ai\\venv\\Scripts\\python.exe -m unittest discover -s ml -p "test_*.py" -v
"""

import io
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

import fetch


def jpeg(w, h, colour=(90, 90, 200)):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), colour).save(buf, 'JPEG', quality=90)
    return buf.getvalue()


def layout(photo, ppm=30, out_mm=2, in_mm=2.5):
    out_px, in_px = round(out_mm * ppm), round(in_mm * ppm)
    W, H = round(63 * ppm), round(88 * ppm)
    lengths = [W + 2 * out_px, H + 2 * out_px, W + 2 * out_px, H + 2 * out_px]
    rows = [{'edge': e, 'y': i * (out_px + in_px), 'length': n} for i, (e, n) in enumerate(zip(['top', 'right', 'bottom', 'left'], lengths))]
    return {'photo': photo, 'turn': None if photo == 1 else 'sideways', 'ppm': ppm, 'outPx': out_px, 'inPx': in_px,
            'outMm': out_mm, 'inMm': in_mm, 'width': max(lengths), 'height': 4 * (out_px + in_px), 'rows': rows}


L1, L2, L3 = layout(1), layout(2, ppm=24), layout(3)
GOOD = jpeg(L1['width'], L1['height'])
GOOD2 = jpeg(L2['width'], L2['height'])
WRONG_SIZE = jpeg(L3['width'] - 10, L3['height'])
CUT = GOOD[: len(GOOD) // 2]


class FakeBackend(BaseHTTPRequestHandler):
    files = {}          # path -> bytes
    deleted = []
    export = {}

    def log_message(self, *a):
        pass

    def _send(self, code, body=b'', ctype='application/octet-stream'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/api/grading/export'):
            return self._send(200, json.dumps(self.export).encode(), 'application/json')
        if self.path in self.files:
            return self._send(200, self.files[self.path], 'image/jpeg')
        return self._send(404, b'{}')

    def do_DELETE(self):
        type(self).deleted.append(self.path)
        if self.path in self.files:
            del self.files[self.path]
            return self._send(204)
        return self._send(404, b'{}')


def copy_with(cid, strips, layouts):
    return {'id': cid, 'updated_at': '2026-11-21T10:00:00.000Z', 'pictures': {}, 'strips': strips,
            'result': {'details': {'back': {'strips': layouts}}}}


class CheckStrip(unittest.TestCase):
    def test_good(self):
        self.assertIsNone(fetch.check_strip(GOOD, L1))

    def test_wrong_size(self):
        self.assertIn('size', fetch.check_strip(WRONG_SIZE, L3))

    def test_cut_short(self):
        self.assertIsNotNone(fetch.check_strip(CUT, L1))

    def test_not_jpeg(self):
        buf = io.BytesIO()
        Image.new('RGB', (L1['width'], L1['height'])).save(buf, 'PNG')
        self.assertEqual(fetch.check_strip(buf.getvalue(), L1), 'not a JPEG')

    def test_no_layout(self):
        self.assertIn('no layout', fetch.check_strip(GOOD, None))

    def test_rows_dont_fit(self):
        bad = dict(L1, rows=L1['rows'][:3])
        self.assertIn("rows", fetch.check_strip(GOOD, bad))


class FetchStrips(unittest.TestCase):
    def setUp(self):
        FakeBackend.deleted = []
        FakeBackend.files = {
            '/api/grading/strips/12-back-1-aa11.jpg': GOOD,
            '/api/grading/strips/12-back-2-bb22.jpg': GOOD2,
            '/api/grading/strips/12-back-3-cc33.jpg': WRONG_SIZE,
            '/api/grading/strips/12-back-4-dd44.jpg': CUT,
            '/api/grading/strips/99-back-1-ee55.jpg': GOOD,     # listed under the wrong copy
        }
        strips = {f'back-{n}': f'/api/grading/strips/12-back-{n}-{t}.jpg' for n, t in [(1, 'aa11'), (2, 'bb22'), (3, 'cc33'), (4, 'dd44')]}
        layouts = [L1, L2, L3, layout(4)]
        FakeBackend.export = {'exportedAt': '2026-11-21T10:00:01.000Z', 'copies': [
            copy_with(12, strips, layouts),
            copy_with(13, {'back-1': '/api/grading/strips/99-back-1-ee55.jpg'}, [L1]),
        ]}
        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), FakeBackend)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.srv.server_address[1]}'
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'data'

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def test_only_verified_strips_are_deleted(self):
        st = fetch.fetch_strips(self.base, self.root, FakeBackend.export['copies'], log=lambda *a: None)
        self.assertEqual(st['listed'], 4)                          # the wrong-copy path isn't a job
        self.assertEqual(st['got'], 2)
        self.assertEqual(st['deleted'], 2)
        self.assertEqual(sorted(FakeBackend.deleted), ['/api/grading/strips/12-back-1-aa11.jpg', '/api/grading/strips/12-back-2-bb22.jpg'])
        # the bad ones and the wrong-copy one are still on the server
        self.assertIn('/api/grading/strips/12-back-3-cc33.jpg', FakeBackend.files)
        self.assertIn('/api/grading/strips/12-back-4-dd44.jpg', FakeBackend.files)
        self.assertIn('/api/grading/strips/99-back-1-ee55.jpg', FakeBackend.files)
        self.assertEqual((self.root / 'strips' / '12-back-1-aa11.jpg').read_bytes(), GOOD)
        self.assertFalse((self.root / 'strips' / '12-back-3-cc33.jpg').exists())
        self.assertEqual(st['failed'], 3)

    def test_dry_run_touches_nothing(self):
        st = fetch.fetch_strips(self.base, self.root, FakeBackend.export['copies'], dry_run=True, log=lambda *a: None)
        self.assertEqual(st['got'], 0)
        self.assertEqual(FakeBackend.deleted, [])
        self.assertFalse(self.root.exists())

    def test_keep_strips(self):
        st = fetch.fetch_strips(self.base, self.root, FakeBackend.export['copies'], keep=True, log=lambda *a: None)
        self.assertEqual(st['got'], 2)
        self.assertEqual(FakeBackend.deleted, [])

    def test_already_gone_counts_as_deleted(self):
        # downloaded last time but the delete never happened: the local copy
        # is checked and the delete is sent again; a 404 is fine
        (self.root / 'strips').mkdir(parents=True)
        (self.root / 'strips' / '12-back-1-aa11.jpg').write_bytes(GOOD)
        del FakeBackend.files['/api/grading/strips/12-back-1-aa11.jpg']
        copies = [copy_with(12, {'back-1': '/api/grading/strips/12-back-1-aa11.jpg'}, [L1])]
        st = fetch.fetch_strips(self.base, self.root, copies, log=lambda *a: None)
        self.assertEqual((st['got'], st['deleted'], st['failed']), (1, 1, 0))

    def test_main_end_to_end(self):
        os.environ['POKECARD_API'] = self.base
        os.environ['POKECARD_AI_DIR'] = str(Path(self.tmp.name))
        rc = fetch.main([])
        self.assertEqual(rc, 1)                                    # the bad strips are reported
        saved = json.loads((self.root / 'copies' / '12.json').read_text(encoding='utf-8'))
        self.assertIn('back-1', saved['strips_seen'])
        self.assertEqual(len(FakeBackend.deleted), 2)
        # strips_seen remembers a strip after the export stops listing it
        FakeBackend.export['copies'][0]['strips'] = {}
        fetch.save_copy(self.root, FakeBackend.export['copies'][0])
        saved = json.loads((self.root / 'copies' / '12.json').read_text(encoding='utf-8'))
        self.assertIn('back-1', saved['strips_seen'])


if __name__ == '__main__':
    unittest.main()
