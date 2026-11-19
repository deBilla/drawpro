#!/usr/bin/env python3
"""
Regenerate packages/mcp/fonts/ from the fonts @excalidraw/excalidraw ships.

    pip install fonttools brotli && python3 packages/mcp/tools/convert-fonts.py

Excalidraw ships woff2; resvg (screenshot_sheet) reads only TTF/OTF. Excalifont
also comes as unicode-range subsets that all claim the same family name, and
resvg resolves a family to a single face — so it would pick whichever subset it
saw first, often one without Latin. They are merged into one file instead. All four
faces are SIL Open Font License, which permits redistribution.
"""
import glob, os
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '../../../node_modules/@excalidraw/excalidraw/dist/prod/fonts')
OUT = os.path.join(HERE, '../fonts')

files = sorted(glob.glob(f'{SRC}/Excalifont/*.woff2')) + [
    f'{SRC}/Virgil/Virgil-Regular.woff2',
    f'{SRC}/Liberation/LiberationSans-Regular.woff2',
    f'{SRC}/Cascadia/CascadiaCode-Regular.woff2',
]
os.makedirs(OUT, exist_ok=True)
for i, f in enumerate(files):
    font = TTFont(f)
    font.flavor = None
    base = os.path.basename(f).split('-Regular')[0]
    name = f'{base}-{i}.ttf' if base == 'Excalifont' else f'{base}.ttf'
    font.save(os.path.join(OUT, name))
    print(name)

subsets = sorted(glob.glob(f'{OUT}/Excalifont-*.ttf'))
Merger().merge(subsets).save(f'{OUT}/Excalifont.ttf')
for f in subsets:
    os.remove(f)
print('Excalifont.ttf (merged)')
