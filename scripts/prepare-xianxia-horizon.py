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
parser.add_argument('--output', type=Path, default=ROOT / 'public/xianxia/textures/huangshan-distant-v2.webp')
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

# Resolve misty ridge boundaries from photographic foreground/background colors,
# rather than making every first dark pixel an opaque vertical column.
solid = silhouette > .99
inside = distance_transform_edt(solid)
outside = distance_transform_edt(~solid)
foreground = solid & (inside >= 12) & (brightness < .72)
background = ~solid & (outside >= 12)
fg = distance_transform_edt(~foreground, return_distances=False, return_indices=True)
bg = distance_transform_edt(~background, return_distances=False, return_indices=True)
linear = np.where(color <= .04045, color / 12.92, ((color + .055) / 1.055) ** 2.4)
f, b = linear[fg[0], fg[1]], linear[bg[0], bg[1]]
direction = f - b
matte = np.sum((linear - b) * direction, axis=2) / np.maximum(np.sum(direction * direction, axis=2), 1e-6)
matte = np.maximum(matte, 1 - np.min(linear / np.maximum(b, 1e-6), axis=2))
matte = np.clip(matte, 0, 1)
silhouette = np.where(inside >= 12, 1, np.where(outside >= 12, 0, matte))
luma_weights = np.array([.2126, .7152, .0722])
luma = linear @ luma_weights
background_luma = b @ luma_weights
foreground_luma = np.maximum(0, (luma - (1 - silhouette) * background_luma) / np.maximum(silhouette, 1e-6))
unmixed = np.clip(linear * (foreground_luma / np.maximum(luma, 1e-6))[:, :, None], 0, 1)
encoded = np.where(unmixed <= .0031308, unmixed * 12.92, 1.055 * unmixed ** (1 / 2.4) - .055)
rgb = np.rint(encoded * 255).astype(np.uint8)


def smooth(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


alpha = silhouette * smooth(x / 45) * smooth((1023 - x) / 45)
alpha *= 1 - smooth((y / 386 - .72) / .28)
nearest = distance_transform_edt(silhouette < .01, return_distances=False, return_indices=True)
rgb[silhouette < .001] = rgb[nearest[0][silhouette < .001], nearest[1][silhouette < .001]]
output = Image.fromarray(np.dstack((rgb, np.rint(alpha * 255).astype(np.uint8))))
output.save(args.output, quality=92, alpha_quality=100, method=6, exact=True)
print(f'{args.output}: {output.width}x{output.height}, {args.output.stat().st_size} bytes')
