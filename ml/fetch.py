"""Downloads the saved grading copies from the PokeCard backend
(GET /api/grading/export) into <POKECARD_AI_DIR>\\data, incrementally.

  data\\exports\\<time>.json   every export answer as it came (snapshots)
  data\\copies\\<id>.json      the latest state of each copy
  data\\pictures\\<file>.jpg   the pictures (skipped when already there)
  data\\state.json            the newest updated_at seen, for ?since=

Run:  E:\\pokecard-ai\\venv\\Scripts\\python.exe ml\\fetch.py [--all]
--all ignores the remembered time and asks for everything again (pictures
already downloaded are still skipped). Copies deleted on the server are not
removed here.
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from common import api_base, data_dir

TIMEOUT = 60


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'pokecard-ml'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--all', action='store_true', help='ignore the remembered time and fetch every copy')
    args = ap.parse_args()

    base = api_base()
    root = data_dir()
    for sub in ('exports', 'copies', 'pictures'):
        (root / sub).mkdir(parents=True, exist_ok=True)
    state_path = root / 'state.json'
    state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    since = None if args.all else state.get('since')

    url = f'{base}/api/grading/export'
    if since:
        url += '?since=' + urllib.parse.quote(since)
    print(f'Asking for copies changed {"after " + since if since else "ever"}...')
    raw = get(url)
    data = json.loads(raw)
    copies = data.get('copies', [])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    (root / 'exports' / f'{stamp}.json').write_bytes(raw)

    got = skipped = failed = 0
    newest = None
    for c in copies:
        (root / 'copies' / f'{c["id"]}.json').write_text(json.dumps(c, indent=1), encoding='utf-8')
        for key, path in (c.get('pictures') or {}).items():
            dest = root / 'pictures' / path.rsplit('/', 1)[-1]
            if dest.exists() and dest.stat().st_size > 0:
                skipped += 1
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
    # is asked for again next time.
    # The database keeps microseconds but the export's times stop at
    # milliseconds, so the cursor goes 1 ms past the newest copy (otherwise
    # it would come back every time).
    if not failed and copies and newest:
        t = datetime.fromisoformat(newest.replace('Z', '+00:00')) + timedelta(milliseconds=1)
        state['since'] = t.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    state['lastRun'] = data.get('exportedAt')
    state_path.write_text(json.dumps(state, indent=1), encoding='utf-8')
    total = len(list((root / 'copies').glob('*.json')))
    print(f'{len(copies)} copies in this export ({total} on disk); pictures: {got} downloaded, '
          f'{skipped} already there, {failed} failed.')
    return 1 if failed else 0


if __name__ == '__main__':
    t = time.time()
    rc = main()
    print(f'Done in {time.time() - t:.1f} s.')
    sys.exit(rc)
