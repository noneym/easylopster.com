# Packs the PNGs from gen-icons.mjs into .ico files (sharp cannot write ICO).
import os, glob
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def ico(frames, out):
    imgs = [Image.open(f).convert("RGBA") for f in frames]
    imgs[0].save(out, format="ICO", sizes=[im.size for im in imgs], append_images=imgs[1:])
    print("wrote", out)

web = os.path.join(root, "apps", "web")
ico([os.path.join(web, "public", "brand", f"favicon-{s}.png") for s in (16, 32, 48)], os.path.join(web, "src", "app", "favicon.ico"))

d = os.path.join(root, "packages", "node-desktop", "build")
ico([os.path.join(d, f"ico-{s}.png") for s in (16, 24, 32, 48, 64, 128, 256)], os.path.join(d, "icon.ico"))
for f in glob.glob(os.path.join(d, "ico-*.png")):
    os.remove(f)
