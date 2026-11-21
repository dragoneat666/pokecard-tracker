"""Contact sheets for eyeballing the edge crops.

  sheet_<label>.png   a grid of that label's crops (at most --max, a random
                      pick for big labels), each magnified --zoom times with
                      its name under it. A red bar under a crop shows where
                      the labelled stretch (nick, spot) sits; the small grey
                      ticks at the sides mark the middle row, where the
                      card's outline should be.
  focus_c<copy>_<side>_<track>_<from>-<to>.png
                      a long strip of one edge, cut straight from the
                      picture (outside at the top), with a ruler of track
                      steps; made for every hand-entered label (+-150 steps
                      round it) and for each --focus given.

Writes into <POKECARD_AI_DIR>\\runs\\sheets\\.
Run:   E:\\pokecard-ai\\venv\\Scripts\\python.exe ml\\sheet.py [--focus 8:back:top:600:800]
"""

import argparse
import csv
import json
import random
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import ai_dir, data_dir, load_copies, picture_path, side_geometry
from crops import LABELS, cut, load_manual

RED, GREY, TEXT, BG = (230, 40, 40), (150, 150, 150), (20, 20, 20), (245, 245, 245)


def font(size):
    for name in ('segoeui.ttf', 'arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def grid(rows, crops_dir, zoom, cols, title):
    f, ft = font(12), font(18)
    tiles = []
    for r in rows:
        im = Image.open(crops_dir / r['file']).convert('RGB')
        w, h = im.size
        im = im.resize((w * zoom, h * zoom), Image.NEAREST)
        tile = Image.new('RGB', (w * zoom + 8, h * zoom + 26), BG)
        tile.paste(im, (4, 4))
        d = ImageDraw.Draw(tile)
        mid = 4 + h * zoom // 2
        d.line([(0, mid), (3, mid)], fill=GREY, width=2)
        d.line([(w * zoom + 4, mid), (w * zoom + 7, mid)], fill=GREY, width=2)
        if r['hit_x0'] != '':
            d.rectangle([4 + int(r['hit_x0']) * zoom, h * zoom + 5, 4 + max(int(r['hit_x0']) + 1, int(r['hit_x1'])) * zoom, h * zoom + 8], fill=RED)
        d.text((4, h * zoom + 9), f"c{r['copy']} {r['side'][0]} {r['track']} {int(float(r['step_from']))}", fill=TEXT, font=f)
        tiles.append(tile)
    tw, th = tiles[0].size
    cols = min(cols, len(tiles))
    nrows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, nrows * th + 34), (255, 255, 255))
    ImageDraw.Draw(sheet).text((6, 6), title, fill=TEXT, font=ft)
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * tw, 34 + (i // cols) * th))
    return sheet


def focus_strip(copy, side, track, s_from, s_to, zoom, marks=()):
    """A strip of one edge from step s_from to s_to, 2.5 mm across, at the
    picture's own resolution, magnified, with a step ruler under it.
    marks: [(from, to, colour)] stretches to underline."""
    im = Image.open(picture_path(copy, side)).convert('RGB')
    g = side_geometry(copy, side, *im.size)
    n = g['geo'].n[track]
    s_from, s_to = max(0, s_from), min(n, s_to)
    across = 2.5 * g['ppm']
    crop = cut(np.asarray(im, dtype=np.float32), g, track, s_from, s_to, across, g['ppm'])
    h, w = crop.shape[:2]
    big = Image.fromarray(crop).resize((w * zoom, h * zoom), Image.NEAREST)
    out = Image.new('RGB', (w * zoom + 20, h * zoom + 70), (255, 255, 255))
    out.paste(big, (10, 30))
    d = ImageDraw.Draw(out)
    f = font(13)
    d.text((10, 6), f"copy {copy['id']} {copy.get('card_name')} - {side} {track} edge, steps {int(s_from)}-{int(s_to)} "
                    f"({g['ppm']:.0f} px/mm, x{zoom}; outside at the top)", fill=TEXT, font=f)
    y0 = 30 + h * zoom
    for a, b, colour in marks:
        x0 = 10 + (max(a, s_from) - s_from) * zoom
        x1 = 10 + (min(b + 1, s_to) - s_from) * zoom
        if x1 > x0:
            d.rectangle([x0, y0 + 3, x1, y0 + 8], fill=colour)
    step = 10 if (s_to - s_from) <= 400 else 50
    for s in range(int(np.ceil(s_from / step) * step), int(s_to) + 1, step):
        x = 10 + (s - s_from) * zoom
        big_tick = s % (step * 5) == 0
        d.line([(x, y0 + 10), (x, y0 + (22 if big_tick else 16))], fill=TEXT, width=1)
        if big_tick:
            d.text((x - 12, y0 + 24), str(s), fill=TEXT, font=f)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--max', type=int, default=240, help='most crops on one sheet (240)')
    ap.add_argument('--zoom', type=int, default=2, help='magnification of the crops (2)')
    ap.add_argument('--cols', type=int, default=12, help='crops per row (12)')
    ap.add_argument('--focus', action='append', default=[], help='copy:side:track:from:to, e.g. 8:back:top:600:800')
    ap.add_argument('--seed', type=int, default=1)
    args = ap.parse_args()

    crops_dir = data_dir() / 'crops'
    out_dir = ai_dir() / 'runs' / 'sheets'
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(crops_dir / 'index.csv', encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))
    by = defaultdict(list)
    for r in rows:
        by[r['label']].append(r)
    rnd = random.Random(args.seed)
    for lab in LABELS:
        lst = by.get(lab)
        if not lst:
            continue
        pick = lst if len(lst) <= args.max else sorted(rnd.sample(lst, args.max), key=lambda r: r['file'])
        title = f'{lab}: {len(lst)} crops' + (f' (random {args.max} shown)' if len(pick) < len(lst) else '')
        p = out_dir / f'sheet_{lab}.png'
        grid(pick, crops_dir, args.zoom, args.cols, title).save(p)
        print(f'{p}  ({len(pick)} of {len(lst)})')

    copies = load_copies()
    wanted = []
    for m in load_manual():
        wanted.append((m['copy'], m['side'], m['track'], m['from'] - 150, m['to'] + 150))
    for spec in args.focus:
        c, side, track, a, b = spec.split(':')
        wanted.append((int(c), side, track, int(a), int(b)))
    for cid, side, track, a, b in wanted:
        copy = copies.get(cid)
        if not copy:
            print(f'copy {cid} not downloaded')
            continue
        e = ((copy['result'].get('details') or {}).get(side) or {}).get('edges') or {}
        marks = [(m['from'], m['to'], (40, 90, 230)) for m in load_manual()
                 if m['copy'] == cid and m['side'] == side and m['track'] == track]
        marks += [(n['from'], n['to'], (40, 90, 230) if n.get('yes') else GREY) for n in e.get('nicks') or [] if n['track'] == track]
        marks += [(s['from'], s['to'], RED) for s in e.get('spots') or [] if s['track'] == track]
        zoom = max(2, min(6, 1600 // max(1, b - a)))
        p = out_dir / f'focus_c{cid}_{side}_{track}_{max(0, a)}-{b}.png'
        focus_strip(copy, side, track, a, b, zoom, marks).save(p)
        print(p)


if __name__ == '__main__':
    main()
