"""Tests for strips.py (mark snapping, strip sampling) and common.mark_edge,
on synthetic strips (no files, no server).

Run:  E:\\pokecard-ai\\venv\\Scripts\\python.exe -m unittest discover -s ml -p "test_*.py" -v
"""

import unittest

import numpy as np

from common import mark_edge
from strips import SideStrips, snap_mark

PINK, DARK, WHITE = (220, 30, 90), (35, 25, 20), (235, 230, 225)


def layout(ppm):
    out, inn = round(2 * ppm), round(2.5 * ppm)
    W, H = round(63 * ppm), round(88 * ppm)
    lengths = [W + 2 * out, H + 2 * out, W + 2 * out, H + 2 * out]
    rows = [{'edge': e, 'y': i * (out + inn), 'length': n} for i, (e, n) in enumerate(zip(['top', 'right', 'bottom', 'left'], lengths))]
    return {'ppm': ppm, 'outPx': out, 'inPx': inn, 'width': max(lengths), 'height': 4 * (out + inn), 'rows': rows}


def strip(ppm, fleck=None, shift_mm=0.0, seed=0):
    """A strip: pink mat outside, dark border inside; fleck = (edge, from_mm,
    to_mm, depth_mm) painted near-white just inside the edge, moved
    shift_mm along (photos line up only to a few tenths of a mm)."""
    lay = layout(ppm)
    img = np.zeros((lay['height'], lay['width'], 3), np.float32)
    out = lay['outPx']
    for r in lay['rows']:
        img[r['y']:r['y'] + out, :r['length']] = PINK
        img[r['y'] + out:r['y'] + out + lay['inPx'], :r['length']] = DARK
        if fleck and fleck[0] == r['edge']:
            _, a, b, d = fleck
            u0, u1 = round(out + (a + shift_mm) * ppm), round(out + (b + shift_mm) * ppm)
            img[r['y'] + out:r['y'] + out + max(1, round(d * ppm)), u0:u1] = WHITE
    img += np.random.default_rng(seed).normal(0, 2.0, img.shape).astype(np.float32)
    return lay, np.clip(img, 0, 255)


def side_strips(*photos):
    ss = SideStrips.__new__(SideStrips)
    ss.copy, ss.side = {'id': 0}, 'front'
    ss.photos = [(i + 1, lay, img) for i, (lay, img) in enumerate(photos)]
    return ss


def bottom_mark(along, kind='other'):
    return {'x': 63 - along, 'y': 87.9, 'kind': kind}


class MarkEdge(unittest.TestCase):
    def test_edges(self):
        self.assertEqual(mark_edge({'x': 15.4, 'y': 87.9})[0], 'bottom')
        e, a, d = mark_edge({'x': 15.4, 'y': 87.9})
        self.assertAlmostEqual(a, 47.6)
        self.assertAlmostEqual(d, 0.1)
        self.assertEqual(mark_edge({'x': 30, 'y': 0.2})[:2], ('top', 30))
        self.assertEqual(mark_edge({'x': 62.8, 'y': 40})[:2], ('right', 40))
        self.assertEqual(mark_edge({'x': 0.3, 'y': 20})[:2], ('left', 68))


class Snap(unittest.TestCase):
    def test_snaps_to_fleck_in_both_photos(self):
        fleck = ('bottom', 48.1, 48.6, 0.08)
        ss = side_strips(strip(23, fleck, 0.0, 1), strip(23, fleck, 0.3, 2))   # photo 2 0.3 mm off
        r = snap_mark(ss, bottom_mark(47.6))
        self.assertTrue(r['snapped'], r)
        self.assertTrue(48.0 <= r['along'] <= 48.95, r)
        self.assertLessEqual(r['from_'], 48.4)
        self.assertGreaterEqual(r['to'], 48.4)

    def test_mixed_resolution(self):
        fleck = ('top', 20.0, 20.6, 0.1)
        ss = side_strips(strip(21, fleck, 0.0, 3), strip(36, fleck, -0.2, 4))
        r = snap_mark(ss, {'x': 20.9, 'y': 0.1, 'kind': 'whitening'})
        self.assertTrue(r['snapped'], r)
        self.assertTrue(19.7 <= r['along'] <= 20.7, r)

    def test_glint_in_one_photo_only_is_not_snapped(self):
        fleck = ('bottom', 48.1, 48.6, 0.08)
        ss = side_strips(strip(23, fleck, 0.0, 5), strip(23, None, 0.0, 6))
        r = snap_mark(ss, bottom_mark(47.6))
        self.assertFalse(r['snapped'], r)
        self.assertEqual(r['along'], 47.6)

    def test_clean_edge_is_not_snapped(self):
        ss = side_strips(strip(23, None, 0, 7), strip(22, None, 0, 8))
        r = snap_mark(ss, bottom_mark(30.0))
        self.assertFalse(r['snapped'], r)

    def test_fleck_out_of_reach_is_not_used(self):
        fleck = ('bottom', 50.0, 50.5, 0.08)                     # 2.4 mm from the tap
        ss = side_strips(strip(23, fleck, 0, 9), strip(23, fleck, 0, 10))
        r = snap_mark(ss, bottom_mark(47.6))
        self.assertFalse(r['snapped'], r)


class Crop(unittest.TestCase):
    def test_crop_is_outside_up_and_sized(self):
        ss = side_strips(strip(23, None, 0, 11))
        c = ss.crop(0, 'right', 40.0, 3.0, 2.5, 40)
        self.assertEqual(c.shape, (100, 120, 3))
        top, bottom = c[:45].mean(axis=(0, 1)), c[55:].mean(axis=(0, 1))
        self.assertGreater(top[0], 150)          # pink outside at the top
        self.assertLess(bottom[0], 60)           # dark border below


if __name__ == '__main__':
    unittest.main()
