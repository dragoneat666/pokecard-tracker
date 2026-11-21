"""Cuts labelled edge close-ups (training crops) from the downloaded copies.

Windows slide along the 4 straight edges of each side: --along mm long
(3), every --stride mm (1.5), --across mm across (2.5), centred on the card's
edge. Every crop is resampled to --ppm px per mm (40) and turned so the edge
runs left to right with the OUTSIDE AT THE TOP: every crop looks like a
piece of the top edge (120 x 100 px with the defaults).

Source, per side:
  strips    the side has edge strips (app v0.7.43+): one crop PER PHOTO for
            every window, from that photo's strip. The photos of one window
            share a window_id and the window's label; `photo`, `turn` and
            `native_ppm` (the strip's own px/mm, 20-40; lower ones are
            upsampled) tell them apart.
  picture   no strips (copies saved before v0.7.43): one crop per window from
            the saved picture (photo 1 only, native 20 px/mm), photo = "pic".

Labels (one per window, first match wins):
  nick-yes          overlaps a suggested nick the user confirmed
  nick-known        overlaps a hand-entered nick (data\\manual_labels.json)
  nick-mark         a user mark of kind "nick"
  missed-whitening  a user mark of kind "other" or "whitening": whitening
                    the app missed
  nick-no           overlaps a suggested nick the user didn't confirm
  whitening         overlaps a counted whitening spot (the app's own finding,
                    not checked by the user)
  mark-other        a user mark of another kind (dents, scratches, creases,
                    marks)
  partial           one of the above only touches the window's outer
                    --edge-mm (0.5): neither a clear yes nor a clear no
  nothing           none of the above (nicks were never asked about before
                    v0.7.40: see nicks_checked)

User marks ({kind, x, y} mm) go to the nearest edge and count from 1 mm
outside it to 1.75 mm inside. Marks of kind nick, other and whitening on
sides with strips are SNAPPED (strips.snap_mark) to the strongest pale fleck
or inward dip within +-1 mm of the tap that shows in every usable photo
(blurred photos and ones whose edge sits off photo 1's are left out; one
photo alone needs a lower score); the label then covers the snapped stretch.
Marks within a corner's rounding are corner marks and stay at the tap.
Unsnapped marks (nothing stood out, a corner, or no strips) cover the tap +-
--mark-mm (0.75). index.csv keeps mark_tap_along_mm, mark_snapped_along_mm,
mark_snapped and mark_snap (snapped / no-fleck / corner / no-strips);
marks.csv lists every mark with the photos used and why others were left
out.

Writes  <POKECARD_AI_DIR>\\data\\crops\\<label>\\<window_id>_<photo>.png
        <POKECARD_AI_DIR>\\data\\crops\\index.csv   (one row per crop)
        <POKECARD_AI_DIR>\\data\\crops\\marks.csv   (one row per user mark)
Run:    E:\\pokecard-ai\\venv\\Scripts\\python.exe ml\\crops.py
"""

import argparse
import csv
import json
import shutil
import sys
from collections import Counter, defaultdict

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

from common import (CARD_H_MM, CARD_W_MM, EDGE_TRACKS, MISSED_WHITENING_KINDS, corner_radius_mm, data_dir,
                    load_copies, mark_corner, mark_edge, picture_path, side_geometry, step_to_along_mm)
from strips import SNAP_KINDS, SideStrips, snap_mark

LABELS = ['nick-yes', 'nick-known', 'nick-mark', 'missed-whitening', 'nick-no', 'whitening', 'mark-other',
          'partial', 'nothing']
SIDE_MM = {'top': CARD_W_MM, 'bottom': CARD_W_MM, 'right': CARD_H_MM, 'left': CARD_H_MM}


def overlaps(a0, a1, b0, b1):
    return a0 <= b1 and a1 >= b0


def load_manual():
    p = data_dir() / 'manual_labels.json'
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding='utf-8')).get('labels', [])


def cut(img, g, track, s_from, s_to, across_px, out_ppm):
    """(For sheet.py's focus strips.) Resamples a stretch of the saved
    picture between track steps s_from and s_to, across_px picture px
    across, outside at the top -> HxWx3 uint8."""
    ppm = g['ppm']
    w_out = max(1, round((s_to - s_from) / ppm * out_ppm))
    h_out = max(1, round(across_px / ppm * out_ppm))
    steps = s_from + (np.arange(w_out) + 0.5) * (s_to - s_from) / w_out - 0.5
    d = -across_px / 2 + (np.arange(h_out) + 0.5) * across_px / h_out
    x0, y0, nx, ny = g['geo'].point(track, 0)
    x1, y1, _, _ = g['geo'].point(track, 1)
    X = x0 + (x1 - x0) * steps[None, :] + nx * d[:, None]
    Y = y0 + (y1 - y0) * steps[None, :] + ny * d[:, None]
    u, v = X + g['margin'] - 0.5, Y + g['margin'] - 0.5
    out = np.empty((h_out, w_out, 3), dtype=np.float32)
    for c in range(3):
        out[..., c] = map_coordinates(img[..., c], [v, u], order=1, mode='nearest')
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


# a point along an edge (mm from its corner-to-corner start, clockwise) ->
# card mm, and the inward direction
EDGE_FRAME = {
    'top': lambda a: ((a, 0.0), (0.0, 1.0)),
    'right': lambda a: ((CARD_W_MM, a), (-1.0, 0.0)),
    'bottom': lambda a: ((CARD_W_MM - a, CARD_H_MM), (0.0, -1.0)),
    'left': lambda a: ((0.0, CARD_H_MM - a), (1.0, 0.0)),
}


def cut_picture(img, g, edge, a0, along_mm, across_mm, ppm):
    """A window from the saved picture, in mm: along a0..a0+along_mm, depth
    -across/2..+across/2, at ppm, outside at the top -> uint8."""
    w, h = round(along_mm * ppm), round(across_mm * ppm)
    along = a0 + (np.arange(w) + 0.5) / ppm
    depth = -across_mm / 2 + (np.arange(h) + 0.5) / ppm
    (px0, py0), (nx, ny) = EDGE_FRAME[edge](0.0)
    (px1, py1), _ = EDGE_FRAME[edge](1.0)
    X = px0 + (px1 - px0) * along[None, :] + nx * depth[:, None]       # card mm
    Y = py0 + (py1 - py0) * along[None, :] + ny * depth[:, None]
    u = X * g['ppm'] + g['margin'] - 0.5                              # picture pixel centres
    v = Y * g['ppm'] + g['margin'] - 0.5
    out = np.empty((h, w, 3), dtype=np.float32)
    for c in range(3):
        out[..., c] = map_coordinates(img[..., c], [v, u], order=1, mode='nearest')
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def edge_row(crop):
    """Where the card starts in a crop: the row with the biggest step in
    brightness (column median), in crop px from the top."""
    grey = crop.astype(np.float32).mean(axis=2)
    prof = np.median(grey, axis=1)
    return int(np.argmax(np.abs(np.diff(prof)))) + 0.5


def windows(edge, along_mm, stride_mm, corner_mm):
    """Window starts (mm along) on an edge's straight part, centred."""
    L = SIDE_MM[edge] - 2 * corner_mm
    if L < along_mm:
        return []
    k = int((L - along_mm) // stride_mm) + 1
    start = corner_mm + (L - (along_mm + (k - 1) * stride_mm)) / 2
    return [start + j * stride_mm for j in range(k)]


def side_items(copy, side, g, manual, ss, args, mark_log):
    """Everything known about a side's edges, as stretches in mm along each
    edge: dict(edge -> list of {kind, from, to, ...})."""
    detail = g['detail']
    e = detail.get('edges') or {}
    ignored = set(e.get('ignored') or [])
    out = defaultdict(list)

    def add(edge, kind, a, b, **kw):
        out[edge].append(dict(kind=kind, from_=a, to=b, **kw))

    mm = lambda st: step_to_along_mm(st - 0.5, g)       # step's start edge -> mm
    for s in e.get('spots') or []:
        if s['track'] not in SIDE_MM:
            continue
        kind = 'spot-doubt' if s.get('doubt') else 'spot-ignored' if s['id'] in ignored else 'spot'
        add(s['track'], kind, mm(s['from']), mm(s['to'] + 1))
    for n in e.get('nicks') or []:
        if n['track'] in SIDE_MM:
            add(n['track'], 'nick-yes' if n.get('yes') else 'nick-no', mm(n['from']), mm(n['to'] + 1))
    for m in manual:
        if m.get('copy') == copy['id'] and m.get('side') == side and m['track'] in SIDE_MM:
            add(m['track'], 'nick-known', mm(m['from']), mm(m['to'] + 1))
    for mk in detail.get('marks') or []:
        kind = mk.get('kind') or 'other'
        edge, tap, depth = mark_edge(mk)
        corner = mark_corner(mk, corner_radius_mm(copy))
        rec = dict(copy=copy['id'], side=side, mark_id=mk.get('id'), kind=kind, x=mk['x'], y=mk['y'], edge=edge,
                   corner=corner or '', depth_mm=round(depth, 2), tap_along_mm=round(tap, 2),
                   near_edge=int(-1.0 <= depth <= args.across / 2 + 0.5), snap_status='', snapped=0,
                   snapped_along_mm='', snapped_from_mm='', snapped_to_mm='', snap_score='', snap_min_z='', photos=0,
                   photos_used='', photos_dropped='')
        if rec['near_edge']:
            a, b = tap - args.mark_mm, tap + args.mark_mm
            if kind in SNAP_KINDS:
                sn = snap_mark(ss, mk) if ss else dict(status='corner' if corner else 'no-strips', score=None, photos=0,
                                                       min_z=None, used=[], dropped=[], snapped=False)
                rec.update(snap_status=sn['status'], snap_score=sn['score'] if sn['score'] is not None else '',
                           snap_min_z=sn['min_z'] or '', photos=sn['photos'],
                           photos_used=' '.join(str(p) for p in sn['used']), photos_dropped='; '.join(sn['dropped']))
                if sn['snapped']:
                    a, b = sn['from_'], sn['to']
                    rec.update(snapped=1, snapped_along_mm=sn['along'], snapped_from_mm=a, snapped_to_mm=b)
            label = 'nick-mark' if kind == 'nick' else 'missed-whitening' if kind in MISSED_WHITENING_KINDS else 'mark-other'
            add(edge, label, a, b, tap=round(tap, 2), snapped=rec['snapped'], snap_status=rec['snap_status'],
                snapped_along=rec['snapped_along_mm'], mark_kind=kind)
        mark_log.append(rec)
    return out


def label_window(items, a0, a1, edge_mm):
    """(label, item, flags) for a window a0..a1 mm."""
    lo, hi = a0 + edge_mm, a1 - edge_mm
    inside = lambda it: overlaps(lo, hi, it['from_'], it['to'])
    touching = lambda it: overlaps(a0, a1, it['from_'], it['to'])
    flags = dict(whitening_doubt=int(any(touching(i) for i in items if i['kind'] == 'spot-doubt')),
                 whitening_ignored=int(any(touching(i) for i in items if i['kind'] == 'spot-ignored')),
                 marks=' '.join(sorted({i['mark_kind'] for i in items if 'mark_kind' in i and touching(i)})))
    order = ['nick-yes', 'nick-known', 'nick-mark', 'missed-whitening', 'nick-no', 'spot', 'mark-other']
    for kind in order:
        for it in items:
            if it['kind'] == kind and inside(it):
                return ('whitening' if kind == 'spot' else kind), it, flags
    for it in items:
        if it['kind'] in order and touching(it):
            return 'partial', it, flags
    return 'nothing', None, flags


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--along', type=float, default=3.0, help='window length along the edge, mm (3)')
    ap.add_argument('--across', type=float, default=2.5, help='window size across the edge, mm (2.5)')
    ap.add_argument('--stride', type=float, default=1.5, help='step between windows, mm (1.5)')
    ap.add_argument('--ppm', type=float, default=40.0, help='crop resolution, px per mm (40)')
    ap.add_argument('--mark-mm', type=float, default=0.75,
                    help='an unsnapped user mark covers its tap +- this, mm along the edge (0.75)')
    ap.add_argument('--edge-mm', type=float, default=0.5,
                    help="a label must reach this far inside the window's ends, mm (0.5); else 'partial'")
    ap.add_argument('--no-strips', action='store_true', help='cut every side from its saved picture')
    args = ap.parse_args()

    copies = load_copies()
    if not copies:
        sys.exit('No copies downloaded yet: run ml\\fetch.py first.')
    manual = load_manual()
    out_dir = data_dir() / 'crops'
    if out_dir.exists():
        shutil.rmtree(out_dir)
    for lab in LABELS:
        (out_dir / lab).mkdir(parents=True, exist_ok=True)

    rows, problems, mark_log = [], [], []
    short_margin = 0
    offsets = defaultdict(list)
    windows_by_label, crops_by_source = Counter(), Counter()
    for cid, copy in sorted(copies.items()):
        for side in ('front', 'back'):
            path = picture_path(copy, side)
            if not path:
                problems.append(f'copy {cid} {side}: no picture downloaded')
                continue
            im = Image.open(path).convert('RGB')
            g = side_geometry(copy, side, *im.size)
            edges = g['detail'].get('edges')
            if not edges:
                problems.append(f'copy {cid} {side}: no edges check saved, skipped')
                continue
            ss = None if args.no_strips else SideStrips(copy, side)
            n_layouts = len(g['detail'].get('strips') or [])
            if ss is not None and n_layouts and len(ss.photos) < n_layouts:
                problems.append(f'copy {cid} {side}: {n_layouts} strips in the layout, {len(ss.photos)} downloaded')
            source = 'strips' if ss else 'picture'
            if source == 'picture':
                img = np.asarray(im, dtype=np.float32)
                if g['margin'] < args.across / 2 * g['ppm']:
                    short_margin += 1
            items = side_items(copy, side, g, manual, ss, args, mark_log)
            nicks = edges.get('nicks')
            unchecked = set(edges.get('nicksUnchecked') or [])
            corner = g['R'] / g['ppm']
            for edge in EDGE_TRACKS:
                for a0 in windows(edge, args.along, args.stride, corner):
                    a1 = a0 + args.along
                    label, it, flags = label_window(items[edge], a0, a1, args.edge_mm)
                    wid = f'c{cid}_{side}_{edge}_{int(round(a0 * 10)):04d}'
                    windows_by_label[label] += 1
                    if source == 'strips':
                        shots = [(str(p), lay.get('turn') or 'first', lay['ppm'], ss.crop(k, edge, a0, args.along, args.across, args.ppm))
                                 for k, (p, lay, _) in enumerate(ss.photos)]
                    else:
                        shots = [('pic', 'first', round(g['ppm'], 2), cut_picture(img, g, edge, a0, args.along, args.across, args.ppm))]
                    for photo, turn, nppm, crop in shots:
                        name = f'{wid}_{"p" + photo if photo != "pic" else "pic"}.png'
                        Image.fromarray(crop).save(out_dir / label / name)
                        offset = edge_row(crop) / args.ppm - args.across / 2
                        offsets[(cid, side, edge, source)].append(offset)
                        w = crop.shape[1]
                        hx = ('', '')
                        if it:
                            hx = (max(0, round((it['from_'] - a0) / args.along * w)),
                                  min(w, max(round((it['from_'] - a0) / args.along * w) + 1, round((it['to'] - a0) / args.along * w))))
                        rows.append({
                            'file': f'{label}/{name}', 'label': label, 'window_id': wid, 'source': source,
                            'photo': photo, 'turn': turn, 'native_ppm': nppm, 'crop_ppm': args.ppm,
                            'copy': cid, 'card': copy.get('card_name'), 'set': copy.get('set_code'),
                            'number': copy.get('card_number'), 'status': copy.get('status'), 'side': side, 'edge': edge,
                            'along_mm_from': round(a0, 2), 'along_mm_to': round(a1, 2),
                            'nicks_checked': int(nicks is not None and edge not in unchecked),
                            'whitening_doubt': flags['whitening_doubt'], 'whitening_ignored': flags['whitening_ignored'],
                            'marks': flags['marks'],
                            'mark_tap_along_mm': it.get('tap', '') if it else '',
                            'mark_snapped_along_mm': it.get('snapped_along', '') if it else '',
                            'mark_snapped': it.get('snapped', '') if it and 'tap' in it else '',
                            'mark_snap': it.get('snap_status', '') if it else '',
                            'hit_x0': hx[0], 'hit_x1': hx[1], 'edge_offset_mm': round(offset, 3),
                            'app_version': copy['result'].get('appVersion'),
                        })
                        crops_by_source[source] += 1

    with open(out_dir / 'index.csv', 'w', newline='', encoding='utf-8') as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)
    if mark_log:
        with open(out_dir / 'marks.csv', 'w', newline='', encoding='utf-8') as fh:
            wr = csv.DictWriter(fh, fieldnames=list(mark_log[0].keys()))
            wr.writeheader()
            wr.writerows(mark_log)

    for (cid, side, edge, source), offs in sorted(offsets.items()):
        med = float(np.median(offs))
        if abs(med) > 0.25:
            problems.append(f'copy {cid} {side} {edge} ({source}): the biggest brightness step sits {med:+.2f} mm from the '
                            f'crop middle (median; a shadow on the mat or print near the edge can cause this)')
    if short_margin:
        problems.insert(0, f'{short_margin} picture-source side(s) have less margin than half the window: '
                           f'the outermost row(s) of those crops repeat the last photo pixel')
    n_windows = sum(windows_by_label.values())
    print(f'{len(rows)} crops ({crops_by_source["strips"]} from strips, {crops_by_source["picture"]} from pictures) '
          f'in {n_windows} windows, {len(copies)} copies, {args.ppm:g} px/mm -> {out_dir}')
    print('Windows per label:')
    for lab in LABELS:
        print(f'  {lab:17s} {windows_by_label[lab]}')
    for m in mark_log:
        st = m['snap_status']
        if not m['near_edge']:
            state = 'not near an edge'
        elif m['snapped']:
            state = (f'snapped to {m["snapped_along_mm"]} mm ({m["snapped_from_mm"]}-{m["snapped_to_mm"]}), '
                     f'score {m["snap_score"]} (needs {m["snap_min_z"]})')
        elif st == 'corner':
            state = f'corner mark ({m["corner"]}), kept at the tap'
        elif st == 'no-fleck':
            state = f'not snapped (score {m["snap_score"]}, needs {m["snap_min_z"]})'
        else:
            state = f'not snapped ({st or "kind not snapped"})'
        if m['photos_used']:
            state += f'; photos used {m["photos_used"]}'
        if m['photos_dropped']:
            state += f'; left out {m["photos_dropped"]}'
        print(f'  mark: copy {m["copy"]} {m["side"]} {m["kind"]} -> {m["edge"]} edge, tap {m["tap_along_mm"]} mm, {state}')
    if problems:
        print('Problems:')
        for p in dict.fromkeys(problems):
            print('  ' + p)


if __name__ == '__main__':
    main()
