"""Downloads the saved grading copies from the PokeCard backend
(GET /api/grading/export) into <POKECARD_AI_DIR>\\data, incrementally, plus
the edge strips, which are then deleted from the server.

  data\\exports\\<time>.json   every export answer as it came (snapshots)
  data\\copies\\<id>.json      the latest state of each copy (strips_seen: every
                              strip ever downloaded for it, since the export
                              stops listing a strip once it's deleted)
  data\\pictures\\<file>.jpg   the pictures (skipped when already there)
  data\\strips\\<file>.jpg     the edge strips (E: holds the ONLY copy: the
                              server deletes them once fetched, no backup)
  data\\state.json            the newest updated_at seen, for ?since=

Strips: after the incremental pass, one more export without ?since lists
every strip still on the server (only those, so it stays small). Each listed
strip is downloaded, written to disk, read back from disk and checked: it
must decode as a JPEG of exactly the width x height its layout
(result.details[side].strips) gives. Only then is DELETE sent for it, and
only for paths the export listed. A strip that fails the check stays on the
server and is reported.

Run:  E:\\pokecard-ai\\venv\\Scripts\\python.exe ml\\fetch.py [--all] [--dry-run] [--keep-strips]
  --all          ignore the remembered time and ask for every copy again
                 (pictures already downloaded are still skipped)
  --dry-run      only list what would be downloaded/deleted; writes nothing
  --keep-strips  download and check strips but don't delete them
Copies deleted on the server are not removed here.
"""

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from PIL import Image

from common import STRIP_PATH_RE, api_base, data_dir, strip_layouts

TIMEOUT = 60


def request(url, method='GET'):
    req = urllib.request.Request(url, method=method, headers={'User-Agent': 'pokecard-ml'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        body = r.read()
        n = r.headers.get('Content-Length')
        if method == 'GET' and n is not None and int(n) != len(body):
            raise ValueError(f'got {len(body)} bytes of {n}')
        return r.status, body


def get(url):
    return request(url)[1]


def check_strip(body, layout):
    """None if the bytes are a complete JPEG of the layout's size, else what's
    wrong."""
    if not layout:
        return 'no layout for it in the copy (result.details[side].strips)'
    if body[:3] != b'\xff\xd8\xff':
        return 'not a JPEG'
    if body.rstrip(b'\x00')[-2:] != b'\xff\xd9':
        return 'JPEG is cut short (no end marker)'
    try:
        im = Image.open(io.BytesIO(body))
        fmt = im.format
        im.load()                      # decodes every pixel; raises on a broken file
    except Exception as e:
        return f"doesn't decode: {e}"
    if fmt != 'JPEG':
        return f'decodes as {fmt}, not JPEG'
    want = (layout.get('width'), layout.get('height'))
    if im.size != want:
        return f'size {im.size[0]}x{im.size[1]}, layout says {want[0]}x{want[1]}'
    rows = layout.get('rows') or []
    row_h = (layout.get('outPx') or 0) + (layout.get('inPx') or 0)
    if len(rows) != 4 or row_h * 4 != im.size[1] or any(r.get('length', 0) > im.size[0] for r in rows):
        return 'layout rows don\'t fit the picture'
    return None


def strip_jobs(copies):
    """[(copy, key, path, side, photo, layout)] for every strip the export
    lists, checking each path is a strip of that copy."""
    jobs, bad = [], []
    for c in copies:
        for key, path in (c.get('strips') or {}).items():
            m = re.match(STRIP_PATH_RE, path or '')
            if not m or int(m.group(1)) != c['id'] or f'{m.group(2)}-{m.group(3)}' != key:
                bad.append(f'copy {c["id"]} {key}: unexpected strip path {path!r}, left alone')
                continue
            side, photo = m.group(2), int(m.group(3))
            jobs.append((c, key, path, side, photo, strip_layouts(c, side).get(photo)))
    return jobs, bad


def fetch_strips(base, root, copies, dry_run=False, keep=False, log=print):
    """Downloads, checks and (unless keep) deletes every listed strip.
    Answers dict(listed, got, deleted, failed, problems)."""
    jobs, problems = strip_jobs(copies)
    out = dict(listed=len(jobs), got=0, deleted=0, failed=0, problems=problems)
    out['failed'] += len(problems)
    (root / 'strips').mkdir(parents=True, exist_ok=True) if not dry_run else None
    for c, key, path, side, photo, layout in jobs:
        dest = root / 'strips' / path.rsplit('/', 1)[-1]
        if dry_run:
            log(f'  would fetch copy {c["id"]} {key} -> {dest}' + ('' if keep else ', then delete it on the server'))
            continue
        try:
            if dest.exists():                         # e.g. the delete failed last time
                body = dest.read_bytes()
                if check_strip(body, layout):
                    body = get(base + path)
            else:
                body = get(base + path)
            err = check_strip(body, layout)
            if err:
                raise ValueError(err)
            tmp = dest.with_suffix('.part')
            tmp.write_bytes(body)
            tmp.replace(dest)
            err = check_strip(dest.read_bytes(), layout)   # what's on disk, not in memory
            if err:
                raise ValueError(f'on disk: {err}')
            out['got'] += 1
        except Exception as e:
            out['failed'] += 1
            problems.append(f'copy {c["id"]} {key}: {e}; kept on the server')
            continue
        if keep:
            continue
        try:
            status, _ = request(base + path, method='DELETE')
            out['deleted'] += 1
        except urllib.error.HTTPError as e:
            if e.code == 404:                        # already gone: fine, we have it
                out['deleted'] += 1
            else:
                problems.append(f'copy {c["id"]} {key}: downloaded, but DELETE answered {e.code}')
        except Exception as e:
            problems.append(f'copy {c["id"]} {key}: downloaded, but DELETE failed: {e}')
    return out


def save_copy(root, c):
    """Writes a copy's latest state, remembering every strip seen for it."""
    p = root / 'copies' / f'{c["id"]}.json'
    seen = {}
    if p.exists():
        try:
            seen = json.loads(p.read_text(encoding='utf-8')).get('strips_seen') or {}
        except ValueError:
            pass
    seen.update(c.get('strips') or {})
    p.write_text(json.dumps({**c, 'strips_seen': seen}, indent=1), encoding='utf-8')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--all', action='store_true', help='ignore the remembered time and fetch every copy')
    ap.add_argument('--dry-run', action='store_true', help="list what would happen; download, write and delete nothing")
    ap.add_argument('--keep-strips', action='store_true', help="don't delete strips on the server after downloading")
    args = ap.parse_args(argv)

    base = api_base()
    root = data_dir()
    if not args.dry_run:
        for sub in ('exports', 'copies', 'pictures', 'strips'):
            (root / sub).mkdir(parents=True, exist_ok=True)
    state_path = root / 'state.json'
    state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    since = None if args.all else state.get('since')

    # 1. copies changed since last time, and their pictures
    url = f'{base}/api/grading/export'
    if since:
        url += '?since=' + urllib.parse.quote(since)
    print(f'Asking for copies changed {"after " + since if since else "ever"}...')
    raw = get(url)
    data = json.loads(raw)
    copies = data.get('copies', [])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not args.dry_run:
        (root / 'exports' / f'{stamp}.json').write_bytes(raw)

    got = skipped = failed = 0
    newest = None
    for c in copies:
        if not args.dry_run:
            save_copy(root, c)
        for key, path in (c.get('pictures') or {}).items():
            dest = root / 'pictures' / path.rsplit('/', 1)[-1]
            if dest.exists() and dest.stat().st_size > 0:
                skipped += 1
                continue
            if args.dry_run:
                print(f'  would fetch copy {c["id"]} {key}')
                continue
            try:
                body = get(base + path)
                if body[:3] != b'\xff\xd8\xff':
                    raise ValueError('not a JPEG')
                tmp = dest.with_suffix('.part')
                tmp.write_bytes(body)
                tmp.replace(dest)
                got += 1
            except Exception as e:  # keep going; the next run tries again
                failed += 1
                print(f'  copy {c["id"]} {key}: {e}', file=sys.stderr)
        if c.get('updated_at') and (newest is None or c['updated_at'] > newest):
            newest = c['updated_at']

    # Only move the cursor on when every picture came down, so a failed one
    # is asked for again next time. The database keeps microseconds but the
    # export's times stop at milliseconds, so the cursor goes 1 ms past the
    # newest copy (otherwise it would come back every time).
    if not args.dry_run:
        if not failed and copies and newest:
            t = datetime.fromisoformat(newest.replace('Z', '+00:00')) + timedelta(milliseconds=1)
            state['since'] = t.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        state['lastRun'] = data.get('exportedAt')
        state_path.write_text(json.dumps(state, indent=1), encoding='utf-8')
    total = len(list((root / 'copies').glob('*.json'))) if (root / 'copies').exists() else 0
    print(f'{len(copies)} copies in this export ({total} on disk); pictures: {got} downloaded, '
          f'{skipped} already there, {failed} failed.')

    # 2. every strip still on the server (a full export: strips are listed
    # only while they exist, and could in theory turn up on an unchanged copy)
    full = json.loads(get(f'{base}/api/grading/export'))
    with_strips = [c for c in full.get('copies', []) if c.get('strips')]
    if with_strips and not args.dry_run:
        for c in with_strips:
            save_copy(root, c)                   # the layouts the check needs
    st = fetch_strips(base, root, with_strips, dry_run=args.dry_run, keep=args.keep_strips)
    print(f'Strips on the server: {st["listed"]}; downloaded and checked {st["got"]}, '
          f'deleted on the server {st["deleted"]}, failed {st["failed"]}.' + (' (dry run)' if args.dry_run else ''))
    for p in st['problems']:
        print('  ' + p, file=sys.stderr)
    return 1 if failed or st['failed'] else 0


if __name__ == '__main__':
    t = time.time()
    rc = main()
    print(f'Done in {time.time() - t:.1f} s.')
    sys.exit(rc)
