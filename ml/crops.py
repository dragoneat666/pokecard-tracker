"""Cuts edge close-ups from the downloaded grading copies.

A window slides along every straight-edge track (top, right, bottom, left)
of each saved picture (front and back). Each close-up is resampled to a
fixed px per mm (so it doesn't depend on the picture's resolution) and
turned so the track runs left to right with the outside of the card at the
top and the card below: every crop looks like a piece of the top edge.

  crop width  = --along mm   (along the edge, step direction left to right)
  crop height = --across mm  (centred on the outline: half outside, half in)

Labels (one per crop, first match wins):
  nick-yes     overlaps a suggested nick the user confirmed ("It's a nick")
  nick-known   overlaps a hand-entered nick (data\\manual_labels.json)
  nick-mark    a user mark of kind "nick" within --mark-mm of the window
  nick-no      overlaps a suggested nick the user didn't confirm
  whitening    overlaps a counted whitening spot (the app's own finding,
               not checked by the user)
  partial      one of the above only grazes the window's ends (see --edge-mm)
  nothing     none of the above (on copies saved before v0.7.40 nicks were
               never asked about, so see the nicks_checked column)
The CSV also has every flag separately (whitening_doubt, whitening_ignored,
other_mark, ...) so the labels can be redrawn later without cutting again.

Writes  <POKECARD_AI_DIR>\\data\\crops\\<label>\\c<copy>_<side>_<track>_<step>.png
        <POKECARD_AI_DIR>\\data\\crops\\index.csv
Run:    E:\\pokecard-ai\\venv\\Scripts\\python.exe ml\\crops.py
"""

import argparse
import csv
import json
import math
import shutil
import sys
from collections import Counter, defaultdict

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

from common import EDGE_TRACKS, data_dir, load_copies, picture_path, side_geometry

LABELS = ['nick-yes', 'nick-known', 'nick-mark', 'nick-no', 'whitening', 'partial', 'nothing']


def overlaps(a0, a1, b0, b1):
    return a0 <= b1 and a1 >= b0


def load_manual():
    p = data_dir() / 'manual_labels.json'
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding='utf-8')).get('labels', [])


def cut(img, g, track, s_from, s_to, across_px, out_ppm):
    """Resamples one window. s_from/s_to: track steps (picture px, may be
    fractional) at the crop's left and right edges. Answers an HxWx3 uint8
    array, outside at the top."""
    ppm = g['ppm']
    w_out = max(1, round((s_to - s_from) / ppm * out_ppm))
    h_out = max(1, round(across_px / ppm * out_ppm))
    # crop pixel centres -> track step and distance in from the outline
    steps = s_from + (np.arange(w_out) + 0.5) * (s_to - s_from) / w_out - 0.5
    d = -across_px / 2 + (np.arange(h_out) + 0.5) * across_px / h_out
    # straight edges: a point is linear in the step (point(i) at the pixel
    # centre i + 0.5, so steps here are already shifted by -0.5)
    x0, y0, nx, ny = g['geo'].point(track, 0)
    x1, y1, _, _ = g['geo'].point(track, 1)
    tx, ty = x1 - x0, y1 - y0
    X = x0 + tx * steps[None, :] + nx * d[:, None]
    Y = y0 + ty * steps[None, :] + ny * d[:, None]
    m = g['margin']
    u = X + m - 0.5            # image pixel-centre coordinates (as edges.js)
    v = Y + m - 0.5
    out = np.empty((h_out, w_out, 3), dtype=np.float32)
    for c in range(3):
        out[..., c] = map_coordinates(img[..., c], [v, u], order=1, mode='nearest')
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def edge_row(crop):
    """Where the card starts in a crop: the row with the biggest step in
    brightness (column median), in crop px from the top."""
    grey = crop.astype(np.float32).mean(axis=2)
    prof = np.median(grey, axis=1)
    grad = np.abs(np.diff(prof))
    return int(np.argmax(grad)) + 0.5


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--along', type=float, default=3.0, help='window length along the edge, mm (3)')
    ap.add_argument('--across', type=float, default=2.5, help='window size across the edge, mm (2.5)')
    ap.add_argument('--stride', type=float, default=1.5, help='step between windows, mm (1.5)')
    ap.add_argument('--ppm', type=float, default=20.0, help='crop resolution, px per mm (20)')
    ap.add_argument('--mark-mm', type=float, default=1.5, help='how near a nick mark must be, mm (1.5)')
    ap.add_argument('--edge-mm', type=float, default=0.5,
                    help="a label must reach this far inside the window's ends, mm (0.5); else 'partial'")
    ap.add_argument('--keep', action='store_true', help="don't clear the old crops first")
    args = ap.parse_args()

    copies = load_copies()
    if not copies:
        sys.exit('No copies downloaded yet: run ml\\fetch.py first.')
    manual = load_manual()
    out_dir = data_dir() / 'crops'
    if out_dir.exists() and not args.keep:
        shutil.rmtree(out_dir)
    for lab in LABELS:
        (out_dir / lab).mkdir(parents=True, exist_ok=True)

    rows, problems, short_margin = [], [], []
    offsets = defaultdict(list)       # (copy, side, track) -> edge offsets, mm
    counts = Counter()
    for cid, copy in sorted(copies.items()):
        for side in ('front', 'back'):
            path = picture_path(copy, side)
            if not path:
                problems.append(f'copy {cid} {side}: no picture downloaded')
                continue
            im = Image.open(path).convert('RGB')
            g = side_geometry(copy, side, *im.size)
            detail = g['detail']
            edges = detail.get('edges')
            if not edges:
                problems.append(f'copy {cid} {side}: no edges check saved, skipped')
                continue
            if abs(g['H'] / g['ppm'] - 88) > 1.0:
                problems.append(f'copy {cid} {side}: card comes out {g["W"] / g["ppm"]:.1f} x {g["H"] / g["ppm"]:.1f} mm (expected 63 x 88)')
            if g['margin'] < args.across / 2 * g['ppm']:
                short_margin.append((cid, side, g['margin'], g['margin'] / g['ppm']))
            img = np.asarray(im, dtype=np.float32)
            ignored = set(edges.get('ignored') or [])
            spots = edges.get('spots') or []
            nicks = edges.get('nicks')                 # None on copies before v0.7.40
            nicks_checked = nicks is not None
            unchecked = set(edges.get('nicksUnchecked') or [])
            marks = detail.get('marks') or []
            mine = [m for m in manual if m.get('copy') == cid and m.get('side') == side]
            ppm = g['ppm']
            along_px, across_px, stride_px = args.along * ppm, args.across * ppm, args.stride * ppm

            for track in EDGE_TRACKS:
                n = g['geo'].n[track]
                if n < along_px:
                    continue
                k = int((n - along_px) // stride_px) + 1
                start = (n - (along_px + (k - 1) * stride_px)) / 2   # centre the run of windows
                for j in range(k):
                    s0 = start + j * stride_px
                    s1 = s0 + along_px
                    # A label counts only where its stretch reaches the window's
                    # inner part (--edge-mm in from each end); a stretch that only
                    # touches the ends makes the crop "partial" (left out of
                    # training, it is neither a clear yes nor a clear no). With
                    # the defaults every point is in the inner part of a window.
                    lo, hi = s0 + args.edge_mm * ppm, s1 - 1 - args.edge_mm * ppm
                    lo_all, hi_all = s0, s1 - 1
                    mid = (s0 + s1) / 2
                    cx, cy, nx, ny = g['geo'].point(track, mid - 0.5)
                    f = {}
                    hit = None                                # (from, to) steps of the main label

                    def first(items, a=None, b=None):
                        a, b = (lo, hi) if a is None else (a, b)
                        for it in items:
                            if overlaps(a, b, it['from'], it['to']):
                                return it
                        return None

                    graze = first([x for x in (nicks or []) if x.get('track') == track]
                                  + [x for x in mine if x.get('track') == track]
                                  + [x for x in spots if x['track'] == track and not x.get('doubt') and x['id'] not in ignored],
                                  lo_all, hi_all)

                    yes = first([x for x in (nicks or []) if x.get('track') == track and x.get('yes')])
                    no = first([x for x in (nicks or []) if x.get('track') == track and not x.get('yes')])
                    known = first([x for x in mine if x.get('track') == track])
                    counted = first([x for x in spots if x['track'] == track and not x.get('doubt') and x['id'] not in ignored])
                    f['whitening_doubt'] = int(first([x for x in spots if x['track'] == track and x.get('doubt')]) is not None)
                    f['whitening_ignored'] = int(first([x for x in spots if x['track'] == track and x['id'] in ignored]) is not None)
                    near_nick = near_other = None
                    for mk in marks:
                        # mark in card px, measured along and in from the window's centre
                        mx, my = mk['x'] * ppm - cx, mk['y'] * ppm - cy
                        a = abs(mx * ny - my * nx)            # along (perpendicular to the normal)
                        inn = mx * nx + my * ny
                        if a <= along_px / 2 + args.mark_mm * ppm and -args.mark_mm * ppm <= inn <= across_px / 2 + args.mark_mm * ppm:
                            if mk.get('kind') == 'nick':
                                near_nick = mk
                            else:
                                near_other = mk
                    f['other_mark'] = near_other['kind'] if near_other else ''

                    if yes:
                        label, hit = 'nick-yes', (yes['from'], yes['to'])
                    elif known:
                        label, hit = 'nick-known', (known['from'], known['to'])
                    elif near_nick:
                        label = 'nick-mark'
                        # along the track: the tangent is (ny, -nx) on straight edges
                        a = (near_nick['x'] * ppm - cx) * ny - (near_nick['y'] * ppm - cy) * nx
                        hit = (mid + a - 0.5 * ppm, mid + a + 0.5 * ppm)
                    elif no:
                        label, hit = 'nick-no', (no['from'], no['to'])
                    elif counted:
                        label, hit = 'whitening', (counted['from'], counted['to'])
                    elif graze:
                        label, hit = 'partial', (graze['from'], graze['to'])
                    else:
                        label = 'nothing'

                    crop = cut(img, g, track, s0, s1, across_px, args.ppm)
                    er = edge_row(crop)
                    offset_mm = er / args.ppm - args.across / 2      # + = card starts further in
                    offsets[(cid, side, track)].append(offset_mm)
                    name = f'c{cid}_{side}_{track}_{int(round(s0)):04d}.png'
                    Image.fromarray(crop).save(out_dir / label / name)
                    w = crop.shape[1]
                    hx = ('', '')
                    if hit:   # where the labelled stretch sits in the crop, crop px
                        hx = (max(0, round((hit[0] - s0) / along_px * w)), min(w, round((hit[1] + 1 - s0) / along_px * w)))
                    rows.append({
                        'file': f'{label}/{name}', 'label': label, 'copy': cid, 'card': copy.get('card_name'),
                        'set': copy.get('set_code'), 'number': copy.get('card_number'), 'status': copy.get('status'),
                        'side': side, 'track': track, 'step_from': round(s0, 1), 'step_to': round(s1, 1),
                        'mm_from': round(s0 / ppm, 2), 'mm_to': round(s1 / ppm, 2), 'src_ppm': round(ppm, 3),
                        'nicks_checked': int(nicks_checked and track not in unchecked),
                        'whitening_doubt': f['whitening_doubt'], 'whitening_ignored': f['whitening_ignored'],
                        'other_mark': f['other_mark'], 'hit_x0': hx[0], 'hit_x1': hx[1],
                        'edge_offset_mm': round(offset_mm, 3), 'app_version': copy['result'].get('appVersion'),
                    })
                    counts[label] += 1

    with open(out_dir / 'index.csv', 'w', newline='', encoding='utf-8') as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)

    # Geometry check: the card's edge should sit in the middle row of every
    # crop. A track whose median is off by more than 0.25 mm is reported.
    for (cid, side, track), offs in sorted(offsets.items()):
        med = float(np.median(offs))
        if abs(med) > 0.25:
            problems.append(f'copy {cid} {side} {track}: the biggest brightness step sits {med:+.2f} mm from the crop middle '
                            f'(median; a shadow on the mat or print near the edge can cause this - check a focus strip)')
    if short_margin:
        mm = min(s[3] for s in short_margin)
        problems.insert(0, f'{len(short_margin)} picture side(s) have a margin of only {mm:.2f} mm (e.g. {short_margin[0][2]} px), '
                           f'less than half the window ({args.across / 2} mm): the outermost row(s) of those crops '
                           f'repeat the last photo pixel')
    allo = np.array([o for v in offsets.values() for o in v])
    print(f'{len(rows)} crops from {len(copies)} copies -> {out_dir}')
    for lab in LABELS:
        print(f'  {lab:11s} {counts[lab]}')
    print(f'Edge position in the crops: median {np.median(allo):+.3f} mm, 90% within '
          f'{np.percentile(np.abs(allo), 90):.2f} mm of the middle row.')
    if problems:
        print('Problems:')
        for p in dict.fromkeys(problems):
            print('  ' + p)


if __name__ == '__main__':
    main()
