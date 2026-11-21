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
| `crops.py` | Slides a 3 × 2.5 mm window (1.5 mm steps) along the 4 straight edges of each saved picture, resampled to 20 px/mm, turned so every crop looks like a piece of the top edge (outside at the top). Writes `data\crops\<label>\*.png` and `data\crops\index.csv`, and prints label counts and geometry warnings. |
| `sheet.py` | `runs\sheets\sheet_<label>.png` grids, and `focus_*.png` strips of one edge with a step ruler (for every hand label, plus `--focus copy:side:track:from:to`). `--strips copy:side [--edge top] [--mm 30:40] [--strip-ppm 40]` instead shows every photo's strips of one side, one under the other per edge, at the same px/mm so they line up. A fleck that shows in every photo is real; a bright line that shows in only some of them is a glint. The bars under photo 1 show what the app found on the saved picture. |
| `common.py` | Settings, paths, `TrackGeometry` (a port of `trackGeometry()` from `frontend/src/grading/edges.js`), and the strip helpers (`strip_layouts`, `strip_u`, `step_to_along_mm`). |

### Labels

Each crop gets one label; the first that applies wins:

| Label | Meaning |
|---|---|
| `nick-yes` | overlaps a suggested nick the user confirmed ("It's a nick") |
| `nick-known` | overlaps a hand-entered nick in `data\manual_labels.json` |
| `nick-mark` | a user mark of kind `nick` is near the window |
| `nick-no` | overlaps a suggested nick the user didn't confirm |
| `whitening` | overlaps a counted whitening spot (the app's own finding, not checked by the user) |
| `partial` | one of the above only touches the window's outer 0.5 mm |
| `nothing` | none of the above |

The CSV also carries the separate flags: `nicks_checked` (0 on copies saved
before v0.7.40, which never asked about nicks), `whitening_doubt`,
`whitening_ignored`, `other_mark`, plus `hit_x0/hit_x1`, which give where in
the crop the labelled stretch sits.

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
  card's top-left; `kind` is one of nick, dents, scratches, creases, marks, other.

Crops are cut in mm and resampled, so a higher-resolution picture later gives
the same crop size.

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
