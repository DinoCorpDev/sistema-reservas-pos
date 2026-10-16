"""
The install icons of the POS and the KDS (public/icons), drawn without image libraries:

    python scripts/make-icons.py public/icons

A plate between a fork and a knife on the app's blue for the till, a kitchen ticket on slate
for the kitchen display. The maskable ones keep the glyph inside the safe zone.
"""
import math, struct, sys, zlib

OUT = sys.argv[1]
WHITE = (255, 255, 255)
POS_BG = (42, 79, 166)   # the app's primary blue
KDS_BG = (30, 41, 59)    # slate, the kitchen display's dark header

def rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def pos_glyph(x, y, bg):
    # A plate between a fork and a knife.
    if circle(x, y, 0.5, 0.5, 0.2):
        return bg if circle(x, y, 0.5, 0.5, 0.145) and not circle(x, y, 0.5, 0.5, 0.125) else WHITE
    if rounded(x, y, 0.205, 0.30, 0.235, 0.70, 0.015):  # fork handle
        return WHITE
    if 0.17 <= x <= 0.27 and 0.30 <= y <= 0.42:  # fork tines
        if (0.17 <= x <= 0.19) or (0.21 <= x <= 0.23) or (0.25 <= x <= 0.27) or y >= 0.39:
            return WHITE
    if rounded(x, y, 0.765, 0.30, 0.805, 0.70, 0.02):  # knife
        return WHITE
    return None

def kds_glyph(x, y, bg):
    # A kitchen ticket: a white card with three lines.
    if rounded(x, y, 0.30, 0.22, 0.70, 0.78, 0.04):
        for top, right in ((0.33, 0.62), (0.45, 0.62), (0.57, 0.52)):
            if rounded(x, y, 0.38, top, right, top + 0.05, 0.02):
                return bg
        return WHITE
    return None

def render(size, bg, glyph, maskable):
    ss = 4
    rows = []
    scale = 0.72 if maskable else 1.0  # the maskable safe zone is the inner 80 % circle
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if not maskable and not rounded(x, y, 0, 0, 1, 1, 0.22):
                        continue
                    gx = 0.5 + (x - 0.5) / scale
                    gy = 0.5 + (y - 0.5) / scale
                    color = glyph(gx, gy, bg) or bg
                    acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2]; acc[3] += 255
            n = ss * ss
            alpha = acc[3] // n
            if alpha == 0:
                row += bytes(4)
            else:
                k = acc[3] / 255
                row += bytes([round(acc[0] / k), round(acc[1] / k), round(acc[2] / k), alpha])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    return png

for name, bg, glyph in (('pos', POS_BG, pos_glyph), ('kds', KDS_BG, kds_glyph)):
    for size, maskable, suffix in ((192, False, '192'), (512, False, '512'), (512, True, 'maskable-512'), (180, True, 'apple-180')):
        with open(f'{OUT}/{name}-{suffix}.png', 'wb') as f:
            f.write(render(size, bg, glyph, maskable))
        print(name, suffix)
