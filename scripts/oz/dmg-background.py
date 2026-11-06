#!/usr/bin/env python3
"""Writes the OZdash DMG background as SVG (530 x 319, the DMG window size).

Light background, the OZdash wordmark at the top, and three emerald dashes
between the app icon (x 132) and the Applications link (x 398), like the
upstream background's three grey dashes.

Usage: python3 scripts/oz/dmg-background.py > out.svg  (see make-branding.sh)
"""
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
lines = subprocess.run(
    [sys.executable, os.path.join(here, 'ozdash-wordmark.py'), '--paths'],
    capture_output=True, text=True, check=True,
).stdout.strip().split('\n')
width = float(lines[0].split()[-1])
paths = lines[1:]
dash = paths[-1]

W, H = 530, 319
mark_h = 22.0
scale = mark_h / 70
mark_w = width * scale
mark_x = (W - mark_w) / 2
mark_y = 34

out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
out.append(f'  <rect width="{W}" height="{H}" fill="#FBFCFD"/>')
out.append(f'  <g transform="translate({mark_x:.2f} {mark_y}) scale({scale:.5f})">')
for d in paths[:-1]:
    out.append(f'    <path fill="#202020" d="{d}"/>')
out.append(f'    <path fill="#10B981" d="{dash}"/>')
out.append('  </g>')
# Three dashes (the dash shape at 1/4 size: 26 x 7), getting stronger to the right.
for x, opacity in ((212, 0.3), (250, 0.6), (288, 1.0)):
    out.append(
        f'  <path fill="#10B981" fill-opacity="{opacity}" '
        f'transform="translate({x} 144.5) scale(0.25)" d="{dash}"/>'
    )
out.append('</svg>')
print('\n'.join(out))
