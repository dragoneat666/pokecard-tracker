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


def side_geometry(copy, side, img_w, img_h):
    """The card's size in the saved picture: dict(margin, W, H, ppm, R, geo),
    or None if the side has no edges check."""
    detail = ((copy.get('result') or {}).get('details') or {}).get(side) or {}
    margin = detail.get('pictureMargin') or 0
    W, H = img_w - 2 * margin, img_h - 2 * margin
    ppm = W / CARD_W_MM
    radius_mm = (((copy.get('result') or {}).get('settings') or {}).get('edges') or {}).get('cornerRadiusMm', 3)
    R = radius_mm * ppm
    return dict(margin=margin, W=W, H=H, ppm=ppm, R=R, geo=TrackGeometry(W, H, R), detail=detail)
