#!/usr/bin/env python3
"""Regenerate app/sw.js: precache every app file so the demo works offline after the first visit.
Run after adding or renaming files in app/ (the cache name changes with the file contents, so old caches are dropped)."""
import hashlib, pathlib, re
APP = pathlib.Path(__file__).resolve().parent.parent / 'app'
files = ['./']
for p in sorted(APP.rglob('*')):
    rel = p.relative_to(APP).as_posix()
    if p.is_dir() or rel.startswith(('tests/', 'node_modules/')) or rel in ('sw.js', 'sw.template.js', 'package.json', 'DEV.md', 'CHANGELOG.md'):
        continue
    if p.suffix in ('.html', '.css', '.js', '.webmanifest', '.png', '.svg'):
        files.append(rel)
h = hashlib.sha256()
for f in files[1:]:
    h.update(f.encode()); h.update((APP / f).read_bytes())
version = re.search(r"APP_VERSION = '([^']+)'", (APP / 'js/routes.js').read_text()).group(1)
cache = f"nirantar-{version}-{h.hexdigest()[:10]}"
body = (APP / 'sw.template.js').read_text().replace('__CACHE__', cache).replace('__FILES__', ',\n  '.join(repr(f) for f in files))
(APP / 'sw.js').write_text(body)
print(f'sw.js: {cache}, {len(files)} files')
