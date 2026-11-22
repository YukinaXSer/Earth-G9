"""Derive a sky-masked distant band from the credited Huangshan photograph.

Run with Python, numpy, scipy and Pillow. The existing licensed WebP is the
default source; no network, height reconstruction or generative fill is used.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, median_filter


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT / 'public/xianxia/textures/huangshan.webp')
parser.add_argument('--output', type=Path, default=ROOT / 'public/xianxia/textures/huangshan-distant.webp')
args = parser.parse_args()

image = Image.open(args.source).convert('RGB')
if image.size != (3840, 1172):
    raise ValueError('Expected the credited 3840x1172 Huangshan source')
image = image.crop((0, 0, 3100, 1172)).resize((1024, 387), Image.Resampling.LANCZOS)
rgb = np.asarray(image).copy()
color = rgb.astype(float) / 255
red, green, blue = color.transpose(2, 0, 1)
brightness = color.mean(axis=2)
spread = color.max(axis=2) - color.min(axis=2)
sky = (((blue > red * 1.06) & (green > red * 1.02)) | (spread < .16)) & (brightness > .70)
land = ~sky
edge = median_filter((land[:-2] & land[1:-1] & land[2:]).argmax(axis=0), size=3)
y, x = np.indices(sky.shape)
silhouette = np.clip((y - edge[None, :] + .7) / 1.4, 0, 1)


def smooth(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


alpha = silhouette * smooth(x / 45) * smooth((1023 - x) / 45)
alpha *= 1 - smooth((y / 386 - .72) / .28)
nearest = distance_transform_edt(silhouette < .99, return_distances=False, return_indices=True)
rgb[silhouette < .99] = rgb[nearest[0][silhouette < .99], nearest[1][silhouette < .99]]
output = Image.fromarray(np.dstack((rgb, np.rint(alpha * 255).astype(np.uint8))))
output.save(args.output, quality=92, alpha_quality=100, method=6, exact=True)
print(f'{args.output}: {output.width}x{output.height}, {args.output.stat().st_size} bytes')
