"""
The install icons of the POS and the KDS (public/icons), drawn without image libraries:

    python scripts/make-icons.py public/icons

The Zitas app icon (brandbook V3.0, DEC-049): the white Z with its teal dot on Deep
Intelligence for the till, and the dark Z on white for the kitchen display, so both read as
Zitas and are told apart on a home screen. The maskable ones keep the glyph inside the safe zone.
"""
import math, struct, sys, zlib

OUT = sys.argv[1]
WHITE = (255, 255, 255)
DEEP = (11, 15, 25)      # Deep Intelligence #0B0F19
TEAL = (32, 184, 189)    # Zitas Teal #20B8BD
POS_BG = DEEP
KDS_BG = (246, 248, 250)  # Soft Background #F6F8FA

def rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def near_segment(x, y, ax, ay, bx, by, r):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    px, py = ax + t * dx, ay + t * dy
    return (x - px) ** 2 + (y - py) ** 2 <= r * r

# The symbol as drawn in components/brand/zitas-logo.tsx (viewBox 0..100), placed in the
# middle 64 % of the icon.
Z_POINTS = [(17, 21), (70, 21), (21, 79), (62, 79)]
STROKE = 7.5
DOT = (82, 79, 9.5)

def z_glyph(z_color):
    def glyph(x, y, bg):
        u = (x - 0.18) / 0.64 * 100
        v = (y - 0.18) / 0.64 * 100 + 0  # vertical centre of the mark
        if circle(u, v, DOT[0], DOT[1], DOT[2]):
            return TEAL
        for (ax, ay), (bx, by) in zip(Z_POINTS, Z_POINTS[1:]):
            if near_segment(u, v, ax, ay, bx, by, STROKE):
                return z_color
        return None
    return glyph

pos_glyph = z_glyph(WHITE)
kds_glyph = z_glyph(DEEP)

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
