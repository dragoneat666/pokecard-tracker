"""Tests for strips.py (mark snapping, strip sampling) and common.mark_edge,
on synthetic strips (no files, no server).

Run:  E:\\pokecard-ai\\venv\\Scripts\\python.exe -m unittest discover -s ml -p "test_*.py" -v
"""

import unittest

import numpy as np
from scipy.ndimage import gaussian_filter

from common import mark_corner, mark_edge
from strips import SNAP_MIN_Z, SNAP_MIN_Z_ONE, SideStrips, photo_quality, snap_mark

PINK, DARK, WHITE = (220, 30, 90), (35, 25, 20), (235, 230, 225)


def layout(ppm):
    out, inn = round(2 * ppm), round(2.5 * ppm)
    W, H = round(63 * ppm), round(88 * ppm)
    lengths = [W + 2 * out, H + 2 * out, W + 2 * out, H + 2 * out]
    rows = [{'edge': e, 'y': i * (out + inn), 'length': n} for i, (e, n) in enumerate(zip(['top', 'right', 'bottom', 'left'], lengths))]
    return {'ppm': ppm, 'outPx': out, 'inPx': inn, 'width': max(lengths), 'height': 4 * (out + inn), 'rows': rows}


def strip(ppm, fleck=None, shift_mm=0.0, seed=0, edge_mm=0.0, blur_mm=0.0):
    """A strip: pink mat outside, dark border inside; fleck = (edge, from_mm,
    to_mm, depth_mm) painted near-white just inside the edge, moved
    shift_mm along (photos line up only to a few tenths of a mm). edge_mm
    moves the card's edge inwards (a photo lined up badly across the edge);
    blur_mm blurs the photo (out of focus)."""
    lay = layout(ppm)
    img = np.zeros((lay['height'], lay['width'], 3), np.float32)
    out = lay['outPx']
    e = out + round(edge_mm * ppm)
    for r in lay['rows']:
        img[r['y']:r['y'] + e, :r['length']] = PINK
        img[r['y'] + e:r['y'] + out + lay['inPx'], :r['length']] = DARK
        if fleck and fleck[0] == r['edge']:
            _, a, b, d = fleck
            u0, u1 = round(out + (a + shift_mm) * ppm), round(out + (b + shift_mm) * ppm)
            img[r['y'] + e:r['y'] + e + max(1, round(d * ppm)), u0:u1] = WHITE
    if blur_mm:
        img = gaussian_filter(img, sigma=(blur_mm * ppm, blur_mm * ppm, 0))
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


class PhotoQuality(unittest.TestCase):
    """(a) A blurred photo, or one whose card edge sits off photo 1's, is
    left out; on the one photo left a mark snaps with the lower threshold."""

    fleck = ('bottom', 48.1, 48.6, 0.1)

    def test_sharp_aligned_photos_both_used(self):
        ss = side_strips(strip(23, self.fleck, 0.0, 1), strip(22, self.fleck, 0.2, 2))
        q = photo_quality(ss, 'bottom', 43.6, 51.6)
        self.assertEqual([x['use'] for x in q], [True, True], q)
        r = snap_mark(ss, bottom_mark(47.6))
        self.assertEqual((r['used'], r['dropped'], r['min_z']), ([1, 2], [], SNAP_MIN_Z))

    def test_blurred_photo_left_out(self):
        ss = side_strips(strip(23, self.fleck, 0.0, 3), strip(23, self.fleck, 0.0, 4, blur_mm=0.15))
        q = photo_quality(ss, 'bottom', 43.6, 51.6)
        self.assertTrue(q[0]['use'], q)
        self.assertFalse(q[1]['use'], q)
        self.assertIn('blurred', q[1]['why'])
        r = snap_mark(ss, bottom_mark(47.6))
        self.assertTrue(r['snapped'], r)
        self.assertEqual(r['used'], [1])
        self.assertEqual(r['min_z'], SNAP_MIN_Z_ONE)
        self.assertTrue(r['dropped'][0].startswith('p2: blurred'), r)

    def test_misplaced_photo_left_out(self):
        # photo 2's card edge 1 mm in from photo 1's, and no fleck in it:
        # with it counted the mark could never snap
        ss = side_strips(strip(23, self.fleck, 0.0, 5), strip(23, None, 0.0, 6, edge_mm=1.0))
        q = photo_quality(ss, 'bottom', 43.6, 51.6)
        self.assertAlmostEqual(q[1]['shift'], 1.0, delta=0.15)
        self.assertFalse(q[1]['use'], q)
        self.assertIn('off photo 1', q[1]['why'])
        r = snap_mark(ss, bottom_mark(47.6))
        self.assertTrue(r['snapped'], r)
        self.assertEqual(r['used'], [1])

    def test_small_misplacement_kept(self):
        ss = side_strips(strip(23, self.fleck, 0.0, 7), strip(23, self.fleck, 0.0, 8, edge_mm=0.3))
        q = photo_quality(ss, 'bottom', 43.6, 51.6)
        self.assertTrue(q[1]['use'], q)

    def test_photo1_stays_when_photo2_is_off_and_sharper(self):
        ss = side_strips(strip(23, self.fleck, 0.0, 9, blur_mm=0.06), strip(23, None, 0.0, 10, edge_mm=1.2))
        q = photo_quality(ss, 'bottom', 43.6, 51.6)
        self.assertEqual([x['use'] for x in q], [True, False], q)


class Corner(unittest.TestCase):
    """(b) Marks within the corner rounding of both edges aren't snapped."""

    def test_mark_corner(self):
        self.assertEqual(mark_corner({'x': 1.3, 'y': 0.5}), 'tl')
        self.assertEqual(mark_corner({'x': 60.6, 'y': -0.5}), 'tr')
        self.assertEqual(mark_corner({'x': 62.0, 'y': 87.0}), 'br')
        self.assertEqual(mark_corner({'x': 0.5, 'y': 86.0}), 'bl')
        self.assertIsNone(mark_corner({'x': 3.5, 'y': 0.1}))     # past the rounding along
        self.assertIsNone(mark_corner({'x': 30.0, 'y': 0.1}))
        self.assertEqual(mark_corner({'x': 3.5, 'y': 0.1}, radius_mm=4), 'tl')

    def test_corner_mark_stays_at_the_tap(self):
        fleck = ('top', 0.8, 1.4, 0.1)                            # a real fleck there
        ss = side_strips(strip(23, fleck, 0.0, 11), strip(23, fleck, 0.0, 12))
        r = snap_mark(ss, {'x': 1.3, 'y': 0.5, 'kind': 'whitening'})
        self.assertFalse(r['snapped'], r)
        self.assertEqual((r['status'], r['corner'], r['along']), ('corner', 'tl', 1.3))

    def test_just_past_the_corner_still_snaps(self):
        fleck = ('top', 3.6, 4.1, 0.1)
        ss = side_strips(strip(23, fleck, 0.0, 13), strip(23, fleck, 0.0, 14))
        r = snap_mark(ss, {'x': 3.4, 'y': 0.1, 'kind': 'whitening'})
        self.assertEqual(r['status'], 'snapped', r)


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
