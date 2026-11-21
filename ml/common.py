"""Shared bits for the PokeCard AI scripts: settings, paths, and the card
outline geometry ported from frontend/src/grading/edges.js."""

import json
import math
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent

TRACKS = ['top', 'tr', 'right', 'br', 'bottom', 'bl', 'left', 'tl']
CORNER_TRACKS = ['tr', 'br', 'bl', 'tl']
EDGE_TRACKS = ['top', 'right', 'bottom', 'left']
CARD_W_MM = 63.0


def load_env():
    """Reads ml/.env (KEY=value lines) into os.environ, without overriding
    anything already set."""
    path = HERE / '.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())


def api_base():
    load_env()
    base = os.environ.get('POKECARD_API', '').rstrip('/')
    if not base:
        raise SystemExit('POKECARD_API is not set: put POKECARD_API=http://<server>:14001 in ml/.env')
    return base


def ai_dir():
    load_env()
    return Path(os.environ.get('POKECARD_AI_DIR', r'E:\pokecard-ai'))


def data_dir():
    return ai_dir() / 'data'


def load_copies():
    """The latest saved state of every downloaded copy, by id."""
    d = data_dir() / 'copies'
    out = {}
    for p in sorted(d.glob('*.json')):
        c = json.loads(p.read_text(encoding='utf-8'))
        out[c['id']] = c
    return out


def picture_path(copy, key):
    """Local file for a copy's picture (front/back/frontThumb/backThumb), or None."""
    url = (copy.get('pictures') or {}).get(key)
    if not url:
        return None
    p = data_dir() / 'pictures' / url.rsplit('/', 1)[-1]
    return p if p.exists() else None


class TrackGeometry:
    """Port of trackGeometry(W, H, R) from edges.js. Card pixels, the card's
    top-left at (0, 0); point(key, i) -> (x, y, nx, ny) with n the inward
    normal. Image coordinates: add the picture margin (pixel i covers
    [i, i+1))."""

    def __init__(self, W, H, R):
        self.W, self.H, self.R = W, H, R
        arc = max(4, round_js(R * math.pi / 2))
        self.n = {}
        self.n['top'] = self.n['bottom'] = max(0, round_js(W - 2 * R))
        self.n['left'] = self.n['right'] = max(0, round_js(H - 2 * R))
        for c in CORNER_TRACKS:
            self.n[c] = arc
        self.arc = arc

    def _corner(self, cx, cy, start, i):
        a = start + (i + 0.5) * (math.pi / 2) / self.arc
        ux, uy = math.cos(a), math.sin(a)
        return cx + self.R * ux, cy + self.R * uy, -ux, -uy

    def point(self, key, i):
        W, H, R = self.W, self.H, self.R
        if key == 'top':
            return R + i + 0.5, 0.0, 0.0, 1.0
        if key == 'right':
            return W, R + i + 0.5, -1.0, 0.0
        if key == 'bottom':
            return W - R - i - 0.5, H, 0.0, -1.0
        if key == 'left':
            return 0.0, H - R - i - 0.5, 1.0, 0.0
        if key == 'tr':
            return self._corner(W - R, R, -math.pi / 2, i)
        if key == 'br':
            return self._corner(W - R, H - R, 0.0, i)
        if key == 'bl':
            return self._corner(R, H - R, math.pi / 2, i)
        if key == 'tl':
            return self._corner(R, R, math.pi, i)
        raise KeyError(key)


def round_js(v):
    """JavaScript Math.round (halves go up, also for negatives)."""
    return math.floor(v + 0.5)


# ─── edge strips (v0.7.43+) ──────────────────────────────────────────────────
# One JPEG per photo of a side: rows top, right, bottom, left stacked, each
# turned so the outside is up and running clockwise round the card, from
# outPx outside the edge to inPx inside, outPx past both corners; short rows
# padded on the right with grey. All photos' strips are lined up with photo 1
# (the app turns a flipped photo's corners round). Layout in
# result.details[side].strips: [{photo, turn, ppm, outPx, inPx, outMm, inMm,
# width, height, rows: [{edge, y, length}]}].

STRIP_PATH_RE = r'^/api/grading/strips/(\d+)-(front|back)-([1-4])-[0-9a-f]+\.jpg$'


def strip_layouts(copy, side):
    """The layout entries of a side's strips, by photo number."""
    d = ((copy.get('result') or {}).get('details') or {}).get(side) or {}
    return {s['photo']: s for s in d.get('strips') or [] if 'photo' in s}


def strip_path(copy, key):
    """Local file of a copy's strip ("front-1" etc.), or None."""
    url = (copy.get('strips_seen') or {}).get(key) or (copy.get('strips') or {}).get(key)
    if not url:
        return None
    p = data_dir() / 'strips' / url.rsplit('/', 1)[-1]
    return p if p.exists() else None


def strip_u(along_mm, layout):
    """Strip column (pixel-centre coordinate) at along_mm from the card's
    corner-to-corner start of that edge."""
    return layout['outPx'] + along_mm * layout['ppm'] - 0.5


CARD_H_MM = 88.0
# user mark kinds (result.details[side].marks); "other" and "whitening" near
# an edge are treated as whitening the app missed
MISSED_WHITENING_KINDS = {'other', 'whitening'}


def mark_edge(mark):
    """A user mark ({kind, x, y} in mm from the card's top-left) -> (edge,
    along_mm, in_mm): the nearest straight edge, how far along it from its
    corner-to-corner start (clockwise, as the tracks and strips run) and
    how far in from it (negative = outside the card)."""
    x, y = mark['x'], mark['y']
    cand = [
        ('top', x, y),
        ('right', y, CARD_W_MM - x),
        ('bottom', CARD_W_MM - x, CARD_H_MM - y),
        ('left', CARD_H_MM - y, x),
    ]
    return min(cand, key=lambda c: abs(c[2]))


def corner_radius_mm(copy):
    """The corner rounding the app used for this copy (settings.edges), mm."""
    return (((copy.get('result') or {}).get('settings') or {}).get('edges') or {}).get('cornerRadiusMm', 3)


def mark_corner(mark, radius_mm=3):
    """'tl', 'tr', 'br' or 'bl' when a user mark is within a corner's
    rounding of both edges (as the app's markSpots puts it on a corner
    track), else None."""
    x, y = mark['x'], mark['y']
    v = 't' if y < radius_mm else 'b' if y > CARD_H_MM - radius_mm else ''
    h = 'l' if x < radius_mm else 'r' if x > CARD_W_MM - radius_mm else ''
    return v + h if v and h else None


def step_to_along_mm(step, g):
    """A straight-edge track step of the saved picture (side_geometry g) ->
    mm along that edge from the card's corner-to-corner start, the same
    direction the strips run (clockwise)."""
    return (g['R'] + step + 0.5) / g['ppm']


def side_geometry(copy, side, img_w, img_h):
    """The card's size in the saved picture: dict(margin, W, H, ppm, R, geo),
    or None if the side has no edges check."""
    detail = ((copy.get('result') or {}).get('details') or {}).get(side) or {}
    margin = detail.get('pictureMargin') or 0
    W, H = img_w - 2 * margin, img_h - 2 * margin
    ppm = W / CARD_W_MM
    R = corner_radius_mm(copy) * ppm
    return dict(margin=margin, W=W, H=H, ppm=ppm, R=R, geo=TrackGeometry(W, H, R), detail=detail)
