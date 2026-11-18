# Builds email/sign-button.gif: the rose-gold REVIEW & SIGN ONLINE button used in customer emails (arcmail.js htmlBody).
# A soft glint crosses it right to left (like the shield) every few seconds. Animated GIF because Gmail and Outlook
# drop CSS animations; first frame is the plain button, so clients that don't animate still show it clean.
# Run: python3 tools/make-sign-button.py   (needs Pillow + Inter SemiBold)
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import glob, os
S = 3                      # supersample
W, H = 600, 104            # GIF size (shown at 300x52 in the email)
BG = (253, 252, 250)       # card color behind the pill
font = ImageFont.truetype(glob.glob('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf')[0], 25 * S)
TEXT, SP = 'REVIEW & SIGN ONLINE', 5.2 * S

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
STOPS = [(0, (246, 214, 207)), (.45, (222, 160, 150)), (1, (184, 106, 96))]   # rose gold, light top to deeper bottom
def grad(y):
    for (p0, c0), (p1, c1) in zip(STOPS, STOPS[1:]):
        if y <= p1: return lerp(c0, c1, (y - p0) / (p1 - p0))
    return STOPS[-1][1]

w, h = W * S, H * S
pad = 4 * S
mask = Image.new('L', (w, h), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, w - pad, h - pad], radius=(h - 2 * pad) // 2, fill=255)
base = Image.new('RGB', (w, h), BG)
fill = Image.new('RGB', (w, h))
d = ImageDraw.Draw(fill)
for y in range(h): d.line([(0, y), (w, y)], fill=grad(y / h))
# thin bright edge along the top for the polished-metal feel
hl = Image.new('L', (w, h), 0)
ImageDraw.Draw(hl).rounded_rectangle([pad + 2 * S, pad + 1 * S, w - pad - 2 * S, h // 2], radius=(h - 2 * pad) // 2, fill=70)
hl = hl.filter(ImageFilter.GaussianBlur(6 * S))
fill = Image.composite(Image.new('RGB', (w, h), (255, 255, 255)), fill, hl)
metal = fill
widths = [font.getlength(c) for c in TEXT]
tw = sum(widths) + SP * (len(TEXT) - 1)
ty = h / 2 - font.getbbox('R')[3] / 2 - font.getbbox('R')[1] / 2

def frame(px=None):
    f = metal
    if px is not None:                   # the glint passes over the metal, under the letters
        g = Image.new('L', (w, h), 0)
        ImageDraw.Draw(g).polygon([(px, 0), (px + 60 * S, 0), (px + 15 * S, h), (px - 45 * S, h)], fill=165)
        g = g.filter(ImageFilter.GaussianBlur(12 * S))
        f = Image.composite(Image.new('RGB', (w, h), (255, 246, 242)), f, g)
    f = f.copy(); d = ImageDraw.Draw(f); x = (w - tw) / 2
    for c, cw in zip(TEXT, widths):
        d.text((x, ty), c, font=font, fill=(28, 26, 24)); x += cw + SP
    out = Image.composite(f, base, mask)
    ImageDraw.Draw(out).rounded_rectangle([pad, pad, w - pad, h - pad], radius=(h - 2 * pad) // 2, outline=(151, 73, 48), width=int(1.2 * S))
    return out

pill = frame()

frames, durs = [pill], [3200]
N = 12
for i in range(N):                       # right to left
    px = w + 70 * S - (w + 200 * S) * (i + 1) / N
    frames.append(frame(px)); durs.append(55)
frames = [f.resize((W, H), Image.LANCZOS) for f in frames]
pal = frames[N // 2].quantize(colors=200, method=Image.Quantize.MEDIANCUT)   # one shared palette keeps the file small
frames = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
out = os.path.join(os.path.dirname(__file__), '..', 'email', 'sign-button.gif')
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True, disposal=1)
print(out, os.path.getsize(out), 'bytes')
