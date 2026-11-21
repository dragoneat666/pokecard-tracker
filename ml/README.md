# PokeCard AI (ml/)

Small trained checkers for the Grading tab, starting with **"nick / not a nick"**
on close-ups of a card's edge. The app runs in Docker on the server; training
and the model run on a separate computer with a GPU and reach the app over the
private network.

Only code lives here. Data, crops, models and outputs live outside the repo,
by default in `E:\pokecard-ai`:

```
E:\pokecard-ai\
  venv\        Python 3.12 + torch (CUDA), numpy, pillow, scikit-learn, tqdm
  data\        downloaded copies, pictures, edge strips, crops, manual_labels.json
               (data\strips\ is the ONLY copy of the strips: back it up)
  models\      trained models
  runs\        contact sheets, training runs
  pip-cache\   pip's download cache (safe to delete)
```

## Setup

Create `ml/.env` (gitignored, never commit it):

```
POKECARD_API=http://<server address>:14001
POKECARD_AI_DIR=E:\pokecard-ai
```

Run everything with the venv's Python, from the repo root:

```
E:\pokecard-ai\venv\Scripts\python.exe ml\fetch.py     # download new/changed copies + strips (deletes strips on the server!)
E:\pokecard-ai\venv\Scripts\python.exe ml\crops.py     # cut and label edge close-ups
E:\pokecard-ai\venv\Scripts\python.exe ml\sheet.py     # contact sheets to eyeball them
E:\pokecard-ai\venv\Scripts\python.exe ml\sheet.py --strips 12:back   # all photos' strips of one side
E:\pokecard-ai\venv\Scripts\python.exe -m unittest discover -s ml -p "test_*.py" -v   # tests (fake local server)
```

Each script has `--help`. `fetch.py --dry-run` only lists what it would do.

| Script | What it does |
|---|---|
| `fetch.py` | `GET /api/grading/export?since=` → `data\copies\<id>.json` (latest state of each copy), `data\exports\<time>.json` (raw snapshots), `data\pictures\` (skips files already there). Remembers the newest `updated_at` in `data\state.json`; `--all` starts over. Then downloads, checks and **deletes on the server** every edge strip still there (see below); `--keep-strips` skips the delete. |
| `test_fetch.py` | Tests the strip check and the download → check → delete order against a fake backend on localhost. |
| `crops.py` | Cuts the labelled training crops (see **Training crops** below): `data\crops\<label>\*.png`, `data\crops\index.csv` (one row per crop) and `data\crops\marks.csv` (one row per user mark). Prints windows per label, where each mark snapped to, and geometry warnings. |
| `strips.py` | Reads the strips in mm (`SideStrips.sample/crop`), judges each photo round a mark (`photo_quality`: blurred, or edge off photo 1's) and snaps user marks to the fleck or dip they point at (`snap_mark`). |
| `test_strips.py` | Tests the snapping (a fleck in both photos, a glint in one, a clean edge, out of reach, mixed px/mm, a blurred or misplaced photo left out, corner marks), `mark_edge`, `mark_corner`, and crop orientation, on synthetic strips. |
| `sheet.py` | `runs\sheets\sheet_<label>.png` grids (the photos of one window sit side by side), and `focus_*.png` strips of one edge with a step ruler (for every hand label, plus `--focus copy:side:track:from:to`). `--strips copy:side [--edge top] [--mm 30:40] [--strip-ppm 40]` instead shows every photo's strips of one side, one under the other per edge, at the same px/mm so they line up. A fleck that shows in every photo is real; a bright line that shows in only some of them is a glint. The bars under photo 1 show what the app found on the saved picture. A yellow arrow above every photo marks each user mark's tap, and a green bar under every photo shows where it snapped to. |
| `common.py` | Settings, paths, `TrackGeometry` (a port of `trackGeometry()` from `frontend/src/grading/edges.js`), the strip helpers (`strip_layouts`, `strip_u`, `step_to_along_mm`), and `mark_edge`. |

## Training crops

**Windows:** 3 mm along × 2.5 mm across (`--along`, `--across`), every 1.5 mm
(`--stride`), on the straight part of each edge (corner radius to corner
radius), centred on the card's edge. Every crop is resampled to **40 px/mm**
(`--ppm`; 120 × 100 px) and turned so the edge runs left to right with the
**outside at the top**. Positions are in mm along the edge from its
corner-to-corner start (clockwise, the same as the strips ruler).

**Source, per side:**

- `strips`: the side has edge strips (app v0.7.43+). It gets **one crop per
  photo** for every window, cut from that photo's strip. The photos of a
  window share its `window_id` and label. `photo`, `turn` and `native_ppm`
  (the strip's own px/mm, 20–40; lower ones are upsampled) tell them apart.
- `picture`: copies saved before v0.7.43 have no strips. One crop per window
  comes from the saved picture (photo 1 only, native 20 px/mm), with `photo`
  = `pic`.

**Why one crop per photo rather than a multi-channel stack:** sides have
2 to 4 photos at different px/mm, and the photos line up along the edge
only to a few tenths of a mm (copy 12's fleck is at 48.2 mm in one photo
and 48.6 mm in the other). A fixed-size stack would need a fixed photo count
and pixel registration that we don't have. Separate crops keep every photo,
let a model be trained per photo and combined per window (all photos, or 3
of 4, as the app's whitening check does), and a stack can still be built
from `index.csv` (group by `window_id`) if that turns out better.

### Labels

Each window gets one label; the first that applies wins:

| Label | Meaning |
|---|---|
| `nick-yes` | overlaps a suggested nick the user confirmed ("It's a nick") |
| `nick-known` | overlaps a hand-entered nick in `data\manual_labels.json` |
| `nick-mark` | a user mark of kind `nick` |
| `missed-whitening` | a user mark of kind `other` or `whitening` (v0.7.44+): whitening the app missed |
| `nick-no` | overlaps a suggested nick the user didn't confirm |
| `whitening` | overlaps a counted whitening spot (the app's own finding, not checked by the user) |
| `mark-other` | a user mark of another kind (dents, scratches, creases, marks) |
| `partial` | one of the above only touches the window's outer 0.5 mm (`--edge-mm`) |
| `nothing` | none of the above |

A label counts where its stretch reaches the window's inner part (0.5 mm in
from each end). With 1.5 mm steps, every point is in the inner part of
some window.

**User marks** (`result.details[side].marks`: `{id, kind, x, y}` in mm from
the card's top-left) go to the nearest edge (top: x; right: y; bottom:
63 − x; left: 88 − y along it). They count from 1 mm outside the edge to
1.75 mm inside. A tap lands about 0.7 mm from the spot, so marks of kind
`nick`, `other` and `whitening` on sides with strips are **snapped**
(`strips.snap_mark`):

- Along ±1 mm of the tap, each photo's strip is scored by how much it stands
  out from the edge round it (±4 mm). There are two scores, each as a robust
  z-score with a floor in real units (3 brightness levels, 0.015 mm): a pale
  fleck in the band from the edge to 0.6 mm inside, and an inward dip of the
  card's outline.
- **Corner marks** are not snapped: a mark within the corner rounding (3 mm,
  `cornerRadiusMm`) of both edges, the same test as the app's `markSpots`,
  stays at the tap (`snap_status` `corner`, `corner` = tl/tr/br/bl). The
  strips run straight; the card's edge curves away there.
- **Which photos count** (`strips.photo_quality`), judged per photo on the
  edge within ±4 mm of the tap:
  - *Misplaced*: the photo's card edge sits more than 0.5 mm across from
    photo 1's (the shift that best lines up the two photos' across-edge
    brightness changes). Photo 1 is the reference and always stays.
  - *Blurred*: sharpness under 0.75 of the sharpest photo left. Sharpness is
    the app's "blur the blur" (`sharpness.js`) across the edge only, at
    20 px/mm, after averaging 0.5 mm along so JPEG noise on the plain mat
    doesn't count as detail. The strip is mostly mat and border, so the
    numbers run lower than the app's whole-photo ones (0.2–0.55); they are
    only compared with each other. A soft shadow on the mat can make photo 1
    the one left out.
  - Settings: `MIN_SHARP_SHARE`, `MAX_SHIFT_MM`, `SNAP_MIN_Z_ONE` in
    `strips.py`, calibrated on few marks (2026-11-21).
- Each usable photo's score is spread ±0.3 mm (the photos don't line up
  exactly), then combined so it has to show in **every usable photo** (3 of
  4 with 4). A glint in one photo doesn't count.
- The strongest combined position scoring at least 8 (at least 6 when only
  one photo is left) is the snap. The label then covers that fleck's
  stretch (where the photos' summed score stays above half its peak).
  Otherwise the mark stays unsnapped and covers the tap ± 0.75 mm
  (`--mark-mm`).
- Calibration: copy 12's marked fleck scores 13.7 on both photos and snaps
  from 47.6 to 48.3 mm (stretch 48.05–48.6). 600 random taps on copies 12–32:
  with two photos 5% reach 8; with one photo 15% reach 6 (10% even reach 8),
  so a lone photo snaps much more easily. Print touching the edge can't be
  told apart from wear this way.

### CSV columns

`index.csv`, one row per crop: `file, label, window_id, source, photo, turn,
native_ppm, crop_ppm, copy, card, set, number, status, side, edge,
along_mm_from, along_mm_to, nicks_checked` (0 on copies saved before
v0.7.40, which never asked about nicks), `whitening_doubt, whitening_ignored,
marks` (kinds of user marks touching the window), `mark_tap_along_mm,
mark_snapped_along_mm, mark_snapped, mark_snap` (for a window labelled from
a mark; `mark_snap` is snapped / no-fleck / corner / no-strips),
`hit_x0, hit_x1` (where in the crop the labelled stretch sits, crop px),
`edge_offset_mm, app_version`.

`marks.csv`, one row per user mark: `copy, side, mark_id, kind, x, y, edge,
corner, depth_mm, tap_along_mm, near_edge, snap_status` (snapped / no-fleck /
corner / no-strips / no-usable-photo; empty for kinds not snapped),
`snapped, snapped_along_mm, snapped_from_mm, snapped_to_mm, snap_score,
snap_min_z` (the threshold it needed: 8, or 6 on one photo), `photos,
photos_used` (photo numbers), `photos_dropped` (e.g. `p2: blurred (0.23 <
0.75 x 0.38)` or `p2: edge +0.75 mm off photo 1's`).

`data\manual_labels.json` holds labels entered by hand for older copies:

```json
{"labels": [{"copy": 8, "side": "back", "track": "top", "from": 694, "to": 710, "label": "nick-known"}]}
```

## The export and the picture geometry

`GET /api/grading/export?since=<ISO time>` → `{exportedAt, copies: [...]}`,
ordered by `updated_at`. A copy has `id, slot, status, label, estimate*,
card_id, card_name, card_number, rarity, set_name, set_code, created_at,
updated_at, result` (the full measurements JSON) and `pictures {front, back,
frontThumb, backThumb}`. Picture paths look like `/api/grading/images/<file>.jpg`;
put the server address in front of them.

The saved `front`/`back` picture is the **first photo** of that side,
straightened, with `result.details[side].pictureMargin` px of background all
round (24 at the time of writing). The turned photos the app used to rule out
glints are not saved.

- Card size: `W = imgW − 2·margin`, `H = imgH − 2·margin`, `ppm = W / 63`
  (20 px/mm now), corner radius `R = result.settings.edges.cornerRadiusMm (3) · ppm`.
- Card coordinates have the card's top-left at (0, 0); image coordinate = card
  coordinate + margin (pixel *i* covers [*i*, *i*+1)).
- 8 tracks, clockwise: `top, tr, right, br, bottom, bl, left, tl`.
  `point(key, i)` → `(x, y, nx, ny)`, where *n* points inward; one step is
  one picture pixel. The top edge runs left→right, the right edge
  top→bottom, the bottom edge right→left and the left edge bottom→top.
- `result.details[side].edges`: `spots [{id, track, from, to, lengthMm,
  depthMm, doubt, maybe?}]` (whitening; `from/to` are steps), `ignored`
  (spot ids the user said aren't whitening), `doubtTracks`, `nicks [{id,
  track, from, to, lengthMm, depthMm, votes, photos, yes}]`, `nicksUnchecked`.
- `result.details[side].marks`: `[{id, kind, x, y}]`, *x* and *y* in mm from the
  card's top-left; `kind` is one of nick, dents, scratches, creases, marks, other, whitening (v0.7.44+).

Crops are cut in mm and resampled, so pictures and strips of any
resolution give the same crop size.

## Edge strips (app v0.7.43+)

Every photo of a side (photo 1 and each turned photo) gives one strip JPEG,
made from the photo at its own detail (`ppm` 20–40 px/mm), so it's sharper
than the saved picture and covers the photos the picture leaves out.

- **Rows** are stacked `top, right, bottom, left`, each `outPx + inPx` tall
  (`outMm` 2 outside the edge, `inMm` 2.5 inside). Each row is turned so the
  **outside is up** and runs clockwise round the card from left to right,
  the same direction as the tracks. The top and bottom rows are shorter and are
  padded on the right with grey (#808080).
- In a row, the card's edge lies between pixel rows `outPx − 1` and `outPx`
  (`row.y + outPx` in the JPEG). Along it, x = `outPx` is the corner-to-corner
  start of the side, `length − 2·outPx` is the side (63 or 88 mm × ppm), and
  the row reaches `outPx` past both corners. Strip column (pixel centre) for
  *a* mm along the side: `outPx + a·ppm − 0.5`.
- A saved picture's track step *i* on a straight edge is
  `(R + i + 0.5) / ppm_picture` mm along the side, so the app's spots and
  nicks (measured on photo 1) can be drawn onto every photo's strips.
- The app turns a flipped photo's corners round before cutting, so **every
  photo's strips line up with photo 1** (to a pixel or two).
- Layout: `result.details[side].strips`: `[{photo, turn (null for photo 1, else
  "sideways" etc.), ppm, outPx, inPx, outMm, inMm, width, height, rows: [{edge,
  y, length}]}]`.

**Server side:** the export lists `strips: {"front-1": "/api/grading/strips/<copy>-<side>-<photo>-<tag>.jpg", ...}`,
but only strips that are **still on the server**. `GET` downloads one;
`DELETE` removes it (204, or 404 if already gone). The server keeps strips
only until they're fetched and doesn't back them up.

**What `fetch.py` does:** after the incremental pass, it asks for the whole
export once more without `?since`, which lists every strip still on the
server. For each one, it checks that the path really is a strip of that copy
and side, downloads it, writes it to `data\strips\`, reads it back from disk
and checks it: a complete JPEG that decodes, of exactly the layout's `width`
× `height`, with 4 rows that fit. Only then does it send `DELETE`, and only for
paths the export listed. A strip that fails stays on the server and is
reported (the exit code is 1). If a delete fails, the next run checks the
local copy and sends the delete again. `copies\<id>.json` keeps
`strips_seen`, every strip ever downloaded for that copy, because the export
stops listing a strip once it's deleted.
