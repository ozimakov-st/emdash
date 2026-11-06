#!/usr/bin/env python3
"""Builds the OZdash wordmark from the upstream Emdash wordmark paths.

The upstream wordmark is a dash plus the letters "Emdash" (499 x 70 units).
OZdash keeps the dash and the "dash" letters, and replaces "Em" with a drawn
"O" and "Z" of the same height and stroke weight. The "dash" letters move left
to close the gap.

Usage: python3 scripts/oz/ozdash-wordmark.py > scripts/oz/ozdash-wordmark.svg
       python3 scripts/oz/ozdash-wordmark.py --paths   # one path per line, for code
The paths go into:
  apps/emdash-desktop/src/core/primitives/app-identity/browser/emdash-logo.tsx
  apps/emdash-desktop/src/renderer/index.html (boot splash)
"""
import re
import sys

DASH = 'M23.235 23.2454H103.519L80.2841 51.1252H0L23.235 23.2454Z'
# Upstream letter paths "d", "a", "s", "h" (absolute commands only).
D = 'M313.382 0V22.1093C308.885 18.153 303.076 15.7814 296.748 15.7814C282.453 15.7814 270.846 27.918 270.846 42.8852C270.846 57.8525 282.453 70 296.748 70C303.076 70 308.885 67.6284 313.382 63.6612L314.852 69.306H326.524V0H313.387H313.382ZM298.966 59.5902C290.453 59.5902 283.562 52.306 283.562 43.3224C283.562 34.3388 290.458 27.0656 298.966 27.0656C305.568 27.0656 311.185 31.4426 313.382 37.6066C314.021 39.377 314.36 41.3115 314.36 43.3224C314.36 45.3333 314.016 47.2678 313.382 49.0492C311.185 55.2131 305.568 59.5902 298.966 59.5902Z'
A = 'M375.71 17.4803V22.1087C371.213 18.1524 365.404 15.7808 359.076 15.7808C344.781 15.7808 333.174 27.9174 333.174 42.8846C333.174 57.8519 344.781 69.9994 359.076 69.9994C365.404 69.9994 371.213 67.6278 375.71 63.6606L377.18 69.3054H388.852V17.4803H375.715H375.71ZM361.295 59.5896C352.781 59.5896 345.89 52.3054 345.89 43.3218C345.89 34.3382 352.786 27.065 361.295 27.065C367.896 27.065 373.513 31.442 375.71 37.606C376.349 39.3765 376.688 41.3109 376.688 43.3218C376.688 45.3327 376.344 47.2672 375.71 49.0486C373.513 55.2125 367.896 59.5896 361.295 59.5896Z'
S = 'M446.218 49.9505C444.437 41.4368 435.77 39.3876 425.147 37.792C416.426 36.4696 410.366 36.0106 410.759 31.2401C411.021 28.0543 414.442 25.0871 419.54 24.639C426.682 23.9997 431.229 27.6609 432.737 33.9396L444.611 33.0543C443.726 24.874 436.89 15.7811 420.59 15.7702C402.48 15.7592 394.606 26.7975 397.027 35.3767C399.661 44.7264 410.305 45.6335 418.098 46.6499C427.721 47.9013 432.972 49.639 432.868 53.6609C432.808 56.2128 429.868 59.1527 422.513 59.2456C414.251 59.3385 409.305 55.7647 407.568 49.6937L395.021 50.5789C395.896 60.5297 405.611 69.9887 420.825 69.9887C439.688 69.9887 448.469 60.6773 446.218 49.945V49.9505Z'
H = 'M465.032 69.2842H452.42V0H465.032V21.7486C465.032 21.7486 468.437 18.1366 475.579 16.5191C484.07 14.6011 492.245 18.3169 496.202 24.4918C498.601 28.235 498.874 33.2514 498.901 37.9016C498.945 46.5246 498.901 69.2842 498.901 69.2842C498.901 69.2842 486.294 69.3224 486.294 69.2842V43.224C486.294 39.0273 486.486 34.2131 484.207 31.1858C480.366 26.082 472.103 26.0874 467.622 31.1858C465.415 33.694 465.038 35.9454 465.038 43.224V69.2842H465.032Z'

TOP, BOTTOM = 0.16436, 69.301  # cap height of the upstream "E"
BAR = 11.7  # horizontal bar thickness of the upstream "E"
GAP = 7.0

def num(value):
    return f'{value:.3f}'.rstrip('0').rstrip('.')

def shift_x(path, dx):
    """Moves an absolute-command path (M L H V C Z) right by dx."""
    out = []
    for command, args in re.findall(r'([MLHVCZ])([^MLHVCZ]*)', path):
        values = [float(v) for v in re.findall(r'-?\d*\.?\d+', args)]
        if command in 'MLC':
            values = [v + dx if i % 2 == 0 else v for i, v in enumerate(values)]
        elif command == 'H':
            values = [v + dx for v in values]
        out.append(command + ' '.join(num(v) for v in values))
    return ''.join(out)

# "O": an elliptical ring, stroke ~13 wide at the sides and ~12 at top/bottom.
o_left, o_width = 127.327, 62.0
cx, cy = o_left + o_width / 2, (TOP + BOTTOM) / 2
rx, ry = o_width / 2, (BOTTOM - TOP) / 2
irx, iry = rx - 13.0, ry - 12.0
O = (
    f'M{num(cx - rx)} {num(cy)}A{num(rx)} {num(ry)} 0 1 0 {num(cx + rx)} {num(cy)}'
    f'A{num(rx)} {num(ry)} 0 1 0 {num(cx - rx)} {num(cy)}Z'
    f'M{num(cx - irx)} {num(cy)}A{num(irx)} {num(iry)} 0 1 1 {num(cx + irx)} {num(cy)}'
    f'A{num(irx)} {num(iry)} 0 1 1 {num(cx - irx)} {num(cy)}Z'
)

# "Z": top and bottom bars like the "E", joined by a diagonal 16.5 units wide.
zl = o_left + o_width + GAP
zr = zl + 50.0
diag = 16.5
Z = (
    f'M{num(zl)} {num(TOP)}H{num(zr)}V{num(TOP + BAR)}'
    f'L{num(zl + diag)} {num(BOTTOM - BAR)}H{num(zr)}V{num(BOTTOM)}H{num(zl)}'
    f'V{num(BOTTOM - BAR)}L{num(zr - diag)} {num(TOP + BAR)}H{num(zl)}Z'
)

# "dash" letters: start one gap after the "Z" (upstream "d" starts at 270.846).
dx = (zr + 6.5) - 270.846
letters = [shift_x(p, dx) for p in (D, A, S, H)]
width = 498.945 + dx

if '--paths' in sys.argv:
    print(f'// width {num(width)}')
    for path in [O, Z, *letters, DASH]:
        print(path)
else:
    print(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(width)} 70">')
    for path in [O, Z, *letters]:
        print(f'  <path fill="currentColor" d="{path}"/>')
    print(f'  <path fill="#10B981" d="{DASH}"/>')
    print('</svg>')
