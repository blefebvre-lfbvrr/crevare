#!/usr/bin/env python3
"""Assemble Crevare en une seule page HTML autonome (CSS + JS inline).

Usage : python3 tools/build_single.py [sortie.html]
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'crevare.html'

html = (root / 'index.html').read_text(encoding='utf-8')
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
body = re.sub(r'\s*<script src="[^"]+"></script>', '', body)

css = (root / 'css' / 'style.css').read_text(encoding='utf-8')
js = '\n'.join((root / 'js' / f).read_text(encoding='utf-8') for f in ('data.js', 'app.js'))
assert '</script' not in js

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    '<title>Crevare</title>\n'
    '<meta name="theme-color" content="#0b1220">\n'
    f'<style>\n{css}</style>\n'
    f'{body.strip()}\n'
    f'<script>\n{js}</script>\n',
    encoding='utf-8',
)
print(out)
