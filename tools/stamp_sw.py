#!/usr/bin/env python3
"""Génère sw.js à partir de tools/sw.template.js : liste des fichiers (depuis index.html) + version (empreinte du contenu).

À lancer après toute modification des fichiers de l'app : python3 tools/stamp_sw.py
"""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
files = ['./', 'index.html', 'manifest.webmanifest']
files += re.findall(r'<link rel="stylesheet" href="([^"]+)">', html)
files += re.findall(r'<script src="([^"]+)"></script>', html)
files += ['icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']

h = hashlib.sha256()
for f in files:
    if f == './':
        continue
    h.update(f.encode())
    h.update((root / f).read_bytes())
version = h.hexdigest()[:12]

tpl = (root / 'tools' / 'sw.template.js').read_text(encoding='utf-8')
out = tpl.replace("'__VERSION__'", json.dumps(version)).replace('__ASSETS__', json.dumps(files, indent=2))
(root / 'sw.js').write_text(out, encoding='utf-8')
print(f'sw.js : version {version}, {len(files)} fichiers')
