"""Assemble dist/ParakeetAI-Mac.zip from Windows: app sources + .env + Mac
installer. The .command keeps its executable bit (unix mode in the zip) and all
text files are written with LF endings so bash on macOS can run them.

Usage (from repo root):  python mac/make-bundle.py
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAC = os.path.join(ROOT, 'mac')
OUT = os.path.join(ROOT, 'dist', 'ParakeetAI-Mac.zip')
TOP = 'ParakeetAI-Mac'
TEXT_EXT = {'.js', '.json', '.html', '.css', '.txt', '.md', '.command', '.env', ''}

files = []  # (source path, path inside zip, executable)
for name in ('package.json', 'build.js', 'LEEME.txt'):
    files.append((os.path.join(MAC, name), name, False))
files.append((os.path.join(MAC, 'Instalar ParakeetAI.command'), 'Instalar ParakeetAI.command', True))

env = os.path.join(ROOT, '.env')
if not os.path.isfile(env):
    sys.exit('ERROR: falta .env en la raíz del repo')
files.append((env, '.env', False))

for base, _dirs, names in os.walk(os.path.join(ROOT, 'src')):
    for n in names:
        p = os.path.join(base, n)
        files.append((p, os.path.relpath(p, ROOT).replace(os.sep, '/'), False))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for src, rel, exe in files:
        data = open(src, 'rb').read()
        ext = os.path.splitext(rel)[1].lower() if not rel.startswith('.') else '.env'
        if ext in TEXT_EXT:
            data = data.replace(b'\r\n', b'\n')
        info = zipfile.ZipInfo(f'{TOP}/{rel}')
        info.create_system = 3  # unix, so external_attr mode is honoured
        info.external_attr = ((0o100755 if exe else 0o100644) << 16)
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)
        print(('x ' if exe else '  ') + rel)

print('\n->', OUT, f'({os.path.getsize(OUT) // 1024} KB)')
