#!/usr/bin/env python3
"""Create or update the pisan-labs repos from scripts/pisan-labs-repos.csv.

The CSV is the editable source of truth for each mirrored app's GitHub
"About" box: one row per app with its folder, repo name, website,
description and topics (separated by spaces). Edit it in a spreadsheet,
save it as CSV, then run:

    python3 scripts/pisan_labs_setup.py --dry-run   # show what would change
    python3 scripts/pisan_labs_setup.py             # do it

Needs the GitHub CLI (`gh`), logged in as an owner of the pisan-labs org.
A missing repo is created public and EMPTY (no README), which is what the
mirror workflow (.github/workflows/mirror.yml) needs for its first push. An
existing repo only has its description, website and topics updated; topics
not in the CSV are removed, so the CSV is the whole truth.
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

ORG = 'pisan-labs'
CSV_PATH = Path(__file__).with_name('pisan-labs-repos.csv')
MAX_DESCRIPTION = 350  # GitHub's limit


def gh(args, dry_run, capture=False):
    if dry_run and not capture:
        print('  would run: gh ' + ' '.join(args))
        return ''
    res = subprocess.run(['gh', *args], capture_output=True, text=True)
    if res.returncode != 0 and not capture:
        raise SystemExit(f'gh {" ".join(args)} failed:\n{res.stderr.strip()}')
    return res.stdout if res.returncode == 0 else None


def main():
    if '-h' in sys.argv or '--help' in sys.argv:
        print(__doc__)
        return
    dry_run = '--dry-run' in sys.argv
    rows = list(csv.DictReader(CSV_PATH.open(newline='', encoding='utf-8')))
    problems = []
    for r in rows:
        if len(r['description']) > MAX_DESCRIPTION:
            problems.append(f"{r['repo']}: description is {len(r['description'])} characters (max {MAX_DESCRIPTION})")
        for t in r['topics'].split():
            if t != t.lower() or len(t) > 50 or not all(c.isalnum() or c == '-' for c in t):
                problems.append(f"{r['repo']}: topic '{t}' must be lowercase letters, digits and hyphens, at most 50")
        if len(r['topics'].split()) > 20:
            problems.append(f"{r['repo']}: more than 20 topics")
    if problems:
        raise SystemExit('Fix the CSV first:\n  ' + '\n  '.join(problems))

    created, updated = [], []
    for r in rows:
        full = f"{ORG}/{r['repo']}"
        topics = r['topics'].split()
        current = gh(['repo', 'view', full, '--json', 'description,homepageUrl,repositoryTopics'], dry_run, capture=True)
        print(full)
        changed = False
        if current is None:
            changed = True
            gh(['repo', 'create', full, '--public', '--description', r['description'], '--homepage', r['homepage']], dry_run)
            print('  created (public, empty)')
            created.append(full)
            have = []
        else:
            info = json.loads(current)
            if info.get('description') != r['description'] or info.get('homepageUrl') != r['homepage']:
                changed = True
                gh(['repo', 'edit', full, '--description', r['description'], '--homepage', r['homepage']], dry_run)
                print('  updated description and website')
                updated.append(full)
            have = [t['name'] for t in (info.get('repositoryTopics') or [])]
        add = [t for t in topics if t not in have]
        remove = [t for t in have if t not in topics]
        if add:
            gh(['repo', 'edit', full, '--add-topic', ','.join(add)], dry_run)
            print(f'  added topics: {" ".join(add)}')
        if remove:
            gh(['repo', 'edit', full, '--remove-topic', ','.join(remove)], dry_run)
            print(f'  removed topics: {" ".join(remove)}')
        if (add or remove) and full not in created and full not in updated:
            updated.append(full)
        if not (changed or add or remove):
            print('  up to date')
    print(f'{len(rows)} repos checked: {len(created)} created, {len(updated)} updated, '
          f'{len(rows) - len(created) - len(updated)} up to date.')
    if created:
        print('Created: ' + ', '.join(created))


if __name__ == '__main__':
    main()
