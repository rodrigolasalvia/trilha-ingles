"""Gera os ícones do app. Uso: python3 tools/make_icons.py"""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(os.path.expanduser('~'), '.fonts', 'BricolageGrotesque.ttf')
BG, FG, ACC = (30, 58, 138), (255, 255, 255), (244, 242, 236)

def icon(size, pad_ratio, radius_ratio, name):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)
    inner = size * (1 - 2 * pad_ratio)
    f = ImageFont.truetype(FONT, int(inner * 0.62))
    try: f.set_variation_by_axes([96, 800, 100])
    except Exception: pass
    text = 'En'
    bb = d.textbbox((0, 0), text, font=f)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    x = (size - w) / 2 - bb[0]
    y = (size - h) / 2 - bb[1] - size * 0.04
    d.text((x, y), text, font=f, fill=FG)
    bar_w, bar_h = inner * 0.42, max(2, size * 0.035)
    by = y + bb[3] + size * 0.05
    d.rounded_rectangle([(size - bar_w) / 2, by, (size + bar_w) / 2, by + bar_h], radius=bar_h / 2, fill=ACC)
    img.save(os.path.join(ROOT, 'icons', name))

icon(192, 0.12, 0.22, 'icon-192.png')
icon(512, 0.12, 0.22, 'icon-512.png')
icon(512, 0.22, 0.0, 'icon-maskable-512.png')
im = Image.new('RGB', (180, 180), BG); src = Image.open(os.path.join(ROOT, 'icons', 'icon-maskable-512.png')).resize((180, 180), Image.LANCZOS)
im.paste(src, (0, 0), src); im.save(os.path.join(ROOT, 'icons', 'apple-touch-icon.png'))
print('ok')
