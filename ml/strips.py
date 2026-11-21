"""Reading the edge strips (app v0.7.43+): sampling them in mm, and snapping
the user's marks to the fleck or dip they point at.

Coordinates: `along` is mm along a straight edge from its corner-to-corner
start (clockwise, as the strips and tracks run); `depth` is mm in from the
card's edge (negative = outside). In a strip row, along a / depth d sits at
pixel-centre column outPx + a*ppm - 0.5 and row row.y + outPx + d*ppm - 0.5.
"""

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d, map_coordinates, maximum_filter1d, median_filter, uniform_filter1d

from common import (CARD_H_MM, CARD_W_MM, MISSED_WHITENING_KINDS, corner_radius_mm, mark_corner, mark_edge,
                    strip_layouts, strip_path)

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

# ─── which photos to trust round a mark ──────────────────────────────────────
# A photo can be out of focus, or its card edge can sit off where photo 1's
# is (the strips are lined up with photo 1). Such a photo can't show a fleck,
# so needing it in every photo would turn every mark down. Each photo is
# judged on the edge within +-QUALITY_CTX_MM of the tap:
#   sharpness  "blur the blur" (Crete-Roffet 2007, as the app's sharpness.js)
#              across the edge only, on the band round it at 20 px/mm:
#              1 = sharp, 0 = blurred. The strip band is mostly plain mat and
#              border, so the numbers run lower than the app's on the whole
#              photo; it is compared with the sharpest photo there instead
#              of a fixed floor (a soft shadow on the mat lowers all photos).
#   shift      where the photo's card edge sits across the edge compared
#              with photo 1's: the shift that best lines up the two photos'
#              across-edge brightness changes (print and shadows alike).
# Calibrated 2026-11-21 on few marks (6 user marks, copies 12-32): the
# blurry sideways photos behind the copy 21 and 27 marks scored 0.18-0.29
# against 0.43-0.45 for photo 1 there, with their edge 0.7-2 mm off; sharp
# pairs stay above 0.8 of each other. Over all edges of copies 12-32 about
# half of the sideways photos come out under 0.75 of photo 1 somewhere (seen
# by eye: softer edges, flecks photo 1 shows gone); a soft shadow on the mat
# can make photo 1 the one left out. 600 random taps: one photo left in 55%,
# and they reach 6 / 7 / 8 in 15% / 12% / 10% of cases (two photos: 5%), so
# a lone photo's threshold buys little by being higher; the copy 21 mark
# scores 6.3. Recheck once there are more marks.
QUALITY_CTX_MM = 4.0       # judged on the edge within +- this of the tap, mm
MIN_SHARP_SHARE = 0.75     # under this share of the sharpest photo's = blurred
MAX_SHIFT_MM = 0.5         # card edge more than this off photo 1's = misplaced
SNAP_MIN_Z_ONE = 6.0       # threshold when only one photo is left to snap on
QUALITY_PPM = 20.0         # px per mm the sharpness is measured at (as the app)


def _sharpness_across(g):
    """blur-the-blur score down the rows of a grey patch (depth x along):
    the share of the pixel-to-pixel change across the edge that a further
    9-pixel blur takes away."""
    R = 4
    d = np.abs(np.diff(g, axis=0))
    c = np.cumsum(np.pad(g, ((1, 0), (0, 0))), axis=0)
    box = (c[2 * R + 1:] - c[:-2 * R - 1]) / (2 * R + 1)       # 9-row averages
    db = np.abs(np.diff(box, axis=0))
    d = d[R:R + db.shape[0]]
    total = d.sum()
    return float(1 - np.minimum(d, db).sum() / total) if total > 0 else 1.0


def photo_quality(ss, edge, a_lo, a_hi, max_shift=MAX_SHIFT_MM, min_share=MIN_SHARP_SHARE):
    """How far each photo of a side can be trusted on edge a_lo..a_hi mm:
    [dict(photo, sharp, shift, use, why)], `why` empty for the ones used."""
    step = 1.0 / QUALITY_PPM
    along = np.arange(max(0.0, a_lo), min(SIDE_MM[edge], a_hi), step)
    depth = np.arange(-1.9, 2.4 + 1e-9, step)
    w = np.array([0.299, 0.587, 0.114], np.float32)
    grey = [ss.sample(k, edge, along, depth) @ w for k in range(len(ss.photos))]
    # across-edge change profiles, for the shift against photo 1
    prof = [np.abs(np.diff(gaussian_filter1d(np.median(g, axis=1), 1.0))) for g in grey]
    n_shift = int(round(1.5 / step))
    ref = prof[0]
    out = []
    for k, g in enumerate(grey):
        shift = 0.0
        if k:
            best, p = -1.0, prof[k]
            for s in range(-n_shift, n_shift + 1):
                a, b = (ref[:len(ref) - s], p[s:]) if s >= 0 else (ref[-s:], p[:len(p) + s])
                score = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
                if score > best:
                    best, shift = score, s * step
        # averaged along first (0.5 mm): JPEG noise on the plain mat would
        # otherwise count as fine detail and make a blurred photo look sharp
        smooth = uniform_filter1d(g, size=int(round(0.5 / step)), axis=1, mode='nearest')
        out.append(dict(photo=ss.photos[k][0], sharp=round(_sharpness_across(smooth), 3), shift=round(shift, 2),
                        use=True, why=''))
    # misplaced first (photo 1 is the reference, so it always stays), then
    # blurred against the sharpest photo left
    for q in out:
        if abs(q['shift']) > max_shift:
            q.update(use=False, why=f"edge {q['shift']:+.2f} mm off photo 1's")
    best = max(q['sharp'] for q in out if q['use'])
    for q in out:
        if q['use'] and q['sharp'] < min_share * best:
            q.update(use=False, why=f"blurred ({q['sharp']:.2f} < {min_share:g} x {best:.2f})")
    return out


def snap_mark(ss, mark, reach=1.0, min_z=SNAP_MIN_Z, min_z_one=SNAP_MIN_Z_ONE, align_mm=0.3, radius_mm=None):
    """Finds the fleck or dip a user mark points at: the strongest position
    within +-reach mm of the tap along its edge, scored on every usable
    photo (photo_quality) and combined so it has to show in all of them (3
    of 4 with 4), like the app's whitening check; on one usable photo alone
    it needs min_z_one. Marks within a corner's rounding of both edges are
    not snapped (the strips run straight, the card's edge curves away
    there). Answers dict(edge, tap, along, from_, to, depth, score,
    snapped, status, corner, photos, used, dropped, min_z); status is
    snapped / no-fleck / corner / no-strips / no-usable-photo."""
    edge, tap, depth = mark_edge(mark)
    if radius_mm is None:
        radius_mm = corner_radius_mm(ss.copy) if ss else 3
    corner = mark_corner(mark, radius_mm)
    out = dict(edge=edge, tap=round(tap, 3), along=tap, from_=None, to=None, depth=depth, score=None,
               snapped=False, status='no-strips', corner=corner or '', photos=len(ss.photos) if ss else 0,
               used=[], dropped=[], min_z=None)
    if corner:
        out['status'] = 'corner'
        return out
    if not ss:
        return out
    side = SIDE_MM[edge]
    a_lo, a_hi = max(0.0, tap - reach), min(side, tap + reach)
    quality = photo_quality(ss, edge, tap - QUALITY_CTX_MM, tap + QUALITY_CTX_MM)
    use = [k for k, q in enumerate(quality) if q['use']]
    out.update(used=[quality[k]['photo'] for k in use],
               dropped=[f"p{q['photo']}: {q['why']}" for q in quality if not q['use']])
    if not use:
        out['status'] = 'no-usable-photo'
        return out
    min_z = min_z if len(use) > 1 else min_z_one
    out['min_z'] = min_z
    # Photos line up along the edge only to a few tenths of a mm (copy 12:
    # the same fleck at 48.2 and 48.6 mm), so each photo's score is first
    # spread +-align_mm (a running max), as the app spreads its depths.
    per, raw = [], []
    for k in use:
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
    out['status'] = 'no-fleck'
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
                   to=round(float(along[j1]), 3), snapped=True, status='snapped')
    return out
