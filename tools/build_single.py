#!/usr/bin/env python3
"""Assemble Crevare en une seule page HTML autonome (CSS + JS inline), dans l'ordre d'index.html.

Usage : python3 tools/build_single.py [sortie.html]

La page produite est destinée à une publication en page unique (cadre claude.ai) :
pas de service worker, pas de manifeste. Le contenu de <body> est repris tel quel.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'crevare.html'

html = (root / 'index.html').read_text(encoding='utf-8')
css_files = re.findall(r'<link rel="stylesheet" href="([^"]+)">', html)
js_files = re.findall(r'<script src="([^"]+)"></script>', html)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
body = re.sub(r'\s*<!-- build:js -->.*?<!-- /build:js -->', '', body, flags=re.S)

missing = [f for f in css_files + js_files if not (root / f).exists()]
if missing:
    sys.exit('Fichiers manquants : ' + ', '.join(missing))

css = '\n'.join(f'/* {f} */\n' + (root / f).read_text(encoding='utf-8') for f in css_files)
js = '\n'.join(f'/* {f} */\n' + (root / f).read_text(encoding='utf-8') for f in js_files)
if re.search(r'</script', js, re.I):
    sys.exit('Le JavaScript contient « </script » : impossible de l\'insérer tel quel.')
if re.search(r'</style', css, re.I):
    sys.exit('Le CSS contient « </style ».')

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    '<title>Crevare</title>\n'
    '<meta name="theme-color" content="#0b1220">\n'
    f'<style>\n{css}\n</style>\n'
    f'{body.strip()}\n'
    f'<script>\n{js}\n</script>\n',
    encoding='utf-8',
)
print(out)
