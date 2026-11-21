"""Reading the edge strips (app v0.7.43+): sampling them in mm, and snapping
the user's marks to the fleck or dip they point at.

Coordinates: `along` is mm along a straight edge from its corner-to-corner
start (clockwise, as the strips and tracks run); `depth` is mm in from the
card's edge (negative = outside). In a strip row, along a / depth d sits at
pixel-centre column outPx + a*ppm - 0.5 and row row.y + outPx + d*ppm - 0.5.
"""

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d, map_coordinates, maximum_filter1d, median_filter

from common import CARD_H_MM, CARD_W_MM, MISSED_WHITENING_KINDS, mark_edge, strip_layouts, strip_path

SIDE_MM = {'top': CARD_W_MM, 'bottom': CARD_W_MM, 'right': CARD_H_MM, 'left': CARD_H_MM}
SNAP_KINDS = MISSED_WHITENING_KINDS | {'nick'}


class SideStrips:
    """All downloaded strips of one side of a copy: photos = [(photo, layout,
    float RGB array)], photo 1 first."""

    def __init__(self, copy, side):
        self.copy, self.side = copy, side
        self.photos = []
        for photo, lay in sorted(strip_layouts(copy, side).items()):
            p = strip_path(copy, f'{side}-{photo}')
            if p:
                self.photos.append((photo, lay, np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)))

    def __bool__(self):
        return bool(self.photos)

    def sample(self, k, edge, along, depth, order=1):
        """RGB at a grid of positions from photo index k: along (W,) and
        depth (H,) in mm -> (H, W, 3) float array."""
        _, lay, img = self.photos[k]
        row = next(r for r in lay['rows'] if r['edge'] == edge)
        ppm, out = lay['ppm'], lay['outPx']
        u = out + np.asarray(along)[None, :] * ppm - 0.5
        v = row['y'] + out + np.asarray(depth)[:, None] * ppm - 0.5
        u, v = np.broadcast_arrays(u, v)
        # keep inside this row's band (rows are stacked in one JPEG)
        v = np.clip(v, row['y'], row['y'] + out + lay['inPx'] - 1)
        u = np.clip(u, 0, row['length'] - 1)
        res = np.empty(u.shape + (3,), dtype=np.float32)
        for c in range(3):
            res[..., c] = map_coordinates(img[..., c], [v, u], order=order, mode='nearest')
        return res

    def crop(self, k, edge, a0, along_mm, across_mm, ppm):
        """A window from photo index k: along a0..a0+along_mm, depth
        -across/2..+across/2, at ppm px per mm, outside at the top -> uint8."""
        w, h = round(along_mm * ppm), round(across_mm * ppm)
        along = a0 + (np.arange(w) + 0.5) / ppm
        depth = -across_mm / 2 + (np.arange(h) + 0.5) / ppm
        return np.clip(self.sample(k, edge, along, depth) + 0.5, 0, 255).astype(np.uint8)


def _robust_z(x, ref, floor):
    """z-score against the median and MAD of ref; the MAD is at least
    `floor` (in x's own units), so a very clean edge doesn't turn a JPEG
    wobble into a huge score."""
    med = np.median(ref)
    mad = np.median(np.abs(ref - med)) * 1.4826
    return (x - med) / max(mad, floor)


PALE_FLOOR = 3.0      # brightness levels (0-255)
DIP_FLOOR = 0.015     # mm


def fleck_scores(ss, k, edge, a_lo, a_hi, grid=0.025, ctx=4.0):
    """How strongly each position along a_lo..a_hi (every `grid` mm) stands
    out on photo index k: a pale fleck just inside the edge, or the edge
    dipping inwards. Both as robust z-scores against the edge within +-ctx
    mm. Answers (along, score)."""
    side = SIDE_MM[edge]
    lo, hi = max(0.0, a_lo - ctx), min(side, a_hi + ctx)
    along = np.arange(lo, hi + 1e-9, grid)
    step = 1.0 / 40                                   # depth sampling, mm
    depth = np.arange(-1.0, 1.2 + 1e-9, step)
    rgb = ss.sample(k, edge, along, depth)            # (D, A, 3)
    L = rgb.mean(axis=2)
    # 1. pale: lighter than that depth row's usual brightness along the edge
    band = (depth >= -0.05) & (depth <= 0.6)
    base = median_filter(L[band], size=(1, max(3, int(round(3.0 / grid)) | 1)), mode='nearest')
    pale = (L[band] - base).max(axis=0)
    # 2. dip: where the card starts (half way from background to border),
    # against its usual position along the edge
    bg = np.median(L[depth <= -0.6], axis=0)
    inner = np.median(L[(depth >= 0.6) & (depth <= 1.0)], axis=0)
    half = np.abs(inner - bg) / 2
    far = np.abs(L - bg[None, :]) >= half[None, :]
    far[depth < -0.5] = False
    first = np.where(far.any(axis=0), far.argmax(axis=0), len(depth) - 1)
    edge_d = depth[first]
    dip = edge_d - median_filter(edge_d, size=max(3, int(round(3.0 / grid)) | 1), mode='nearest')
    # smooth a little along (JPEG noise), then z-score against the context
    pale = gaussian_filter1d(pale, 0.05 / grid)
    dip = gaussian_filter1d(dip, 0.05 / grid)
    score = np.maximum(_robust_z(pale, pale, PALE_FLOOR), _robust_z(dip, dip, DIP_FLOOR))
    keep = (along >= a_lo) & (along <= a_hi)
    return along[keep], score[keep]


# Calibration (2026-11-21, copies 12-15): the copy 12 fleck scores 13.7;
# 320 random taps on the same strips reach 8 only 6% of the time, mostly on
# fronts where print touches the edge.
SNAP_MIN_Z = 8.0


def snap_mark(ss, mark, reach=1.0, min_z=SNAP_MIN_Z, align_mm=0.3):
    """Finds the fleck or dip a user mark points at: the strongest position
    within +-reach mm of the tap along its edge, scored on every photo and
    combined so it has to show in all of them (3 of 4 with 4 photos), like
    the app's whitening check. Answers dict(edge, tap, along, from_, to,
    depth, score, snapped, photos)."""
    edge, tap, depth = mark_edge(mark)
    out = dict(edge=edge, tap=round(tap, 3), along=tap, from_=None, to=None, depth=depth, score=None,
               snapped=False, photos=len(ss.photos) if ss else 0)
    if not ss:
        return out
    side = SIDE_MM[edge]
    a_lo, a_hi = max(0.0, tap - reach), min(side, tap + reach)
    # Photos line up along the edge only to a few tenths of a mm (copy 12:
    # the same fleck at 48.2 and 48.6 mm), so each photo's score is first
    # spread +-align_mm (a running max), as the app spreads its depths.
    per, raw = [], []
    for k in range(len(ss.photos)):
        along, sc = fleck_scores(ss, edge=edge, k=k, a_lo=a_lo - align_mm, a_hi=a_hi + align_mm)
        raw.append(sc)
        per.append(maximum_filter1d(sc, size=2 * int(round(align_mm / 0.025)) + 1, mode='nearest'))
    keep = (along >= a_lo) & (along <= a_hi)
    along = along[keep]
    per = np.sort(np.stack(per)[:, keep], axis=0)     # ascending over photos
    # where it is: the peak of the photos' summed raw scores within the
    # combined stretch (the spread alone would blur the position)
    raw_sum = np.stack(raw)[:, keep].sum(axis=0)
    n = per.shape[0]
    need = n - 1 if n >= 4 else n                     # all photos, or 3 of 4
    combined = per[n - need]                          # the (need)th largest
    i = int(np.argmax(combined))
    out['score'] = round(float(combined[i]), 2)
    if combined[i] >= min_z:
        # Where it is: the peak of the photos' summed raw scores within
        # align_mm of the combined peak (the spread blurs the position), and
        # its stretch: round that peak, while the sum stays above half.
        w = int(round(align_mm / 0.025))
        a, b = max(0, i - w), min(len(raw_sum) - 1, i + w)
        p = a + int(np.argmax(raw_sum[a:b + 1]))
        j0 = j1 = p
        while j0 > 0 and raw_sum[j0 - 1] >= raw_sum[p] / 2:
            j0 -= 1
        while j1 < len(raw_sum) - 1 and raw_sum[j1 + 1] >= raw_sum[p] / 2:
            j1 += 1
        out.update(along=round(float(along[p]), 3), from_=round(float(along[j0]), 3),
                   to=round(float(along[j1]), 3), snapped=True)
    return out
