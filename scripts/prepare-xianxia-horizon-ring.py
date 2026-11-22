#!/usr/bin/env python3
"""Composite a sky-free distant ring from the credited captures, not a sky sphere."""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, median_filter

parser = argparse.ArgumentParser()
parser.add_argument('--panorama', type=Path, required=True)
parser.add_argument('--east', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def linear(x):
    return np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)


def encoded(x):
    return np.where(x <= .0031308, x * 12.92, 1.055 * np.maximum(x, 0) ** (1 / 2.4) - .055)


panorama = Image.open(args.panorama).convert('RGB')
if panorama.size != (8192, 4096):
    raise ValueError('Expected the credited 8192x4096 Shudu Lake tonemapped full panorama')
pano = np.asarray(panorama.resize((3072, 1536), Image.Resampling.LANCZOS))
r, g, b = np.moveaxis(pano.astype(float), 2, 0)
land = ((g > b * 1.02) & (r < 160)) | ((r + g + b) / 3 < 115)
land[:int(len(pano) * .35)] = False
land[int(len(pano) * .51):] = True
profile = median_filter(np.argmax(land, axis=0).astype(float), size=13, mode='wrap')
east = np.asarray(Image.open(args.east).convert('RGBA')).astype(float) / 255
if east.shape != (387, 1024, 4):
    raise ValueError('Expected the original sky-free Huangshan v2 derivative')
east_angle = 135
east_eye = .52
east_vertical = east_angle * east.shape[0] / east.shape[1]
side = np.array([-64, 64])
side_x = (side / east_angle + .5) * (east.shape[1] - 1)
side_top = np.array([np.flatnonzero(east[:, round(x), 3] > .1)[0] for x in side_x])
side_height = (east_eye - side_top / (east.shape[0] - 1)) * east_vertical

# Put the lake-facing opening behind Huangshan; the genuine circumferential
# forested ridges hide the two old photographic limits.
best = None
for rotation in np.arange(0, 1, 1 / 1024):
    p = np.interp(((np.r_[side, 0] / 360 + .5 + rotation) % 1) * len(profile), np.arange(len(profile)), profile, period=len(profile))
    heights = 90 - p * 180 / len(pano)
    loss = np.sum(np.maximum(side_height + 2 - heights[:2], 0) ** 2) + max(heights[2] - 8, 0) ** 2
    if best is None or loss < best[0]:
        best = (loss, rotation, heights)
rotation = best[1]
width, height = 3072, 432
u, v = np.meshgrid(np.linspace(0, 1, width), np.linspace(0, 1, height))
azimuth = (u - .5) * 360
elevation = (.65 - v) * 360 * height / width
px = ((u + rotation) % 1) * len(profile)
py = (90 - elevation) / 180 * len(pano)
top = np.interp(px, np.arange(len(profile)), profile, period=len(profile))
alpha = smooth((py - top) / 1.5) * (1 - smooth((-elevation - .5) / 3.5))
rgb = np.stack([map_coordinates(pano[:, :, c].astype(float), [np.maximum(py, top + 2), px], order=1, mode='grid-wrap') for c in range(3)], axis=2) / 255
ex = (azimuth / east_angle + .5) * (east.shape[1] - 1)
ey = (east_eye - elevation / east_vertical) * (east.shape[0] - 1)
east_rgba = np.stack([map_coordinates(east[:, :, c], [ey, ex], order=1, mode='constant', cval=0) for c in range(4)], axis=2)


def over(front_rgb, front_alpha, back_rgb, back_alpha):
    a = front_alpha + back_alpha * (1 - front_alpha)
    rgb = (front_rgb * front_alpha[:, :, None] + back_rgb * (back_alpha * (1 - front_alpha))[:, :, None]) / np.maximum(a[:, :, None], 1e-8)
    return rgb, a


base_rgb = linear(rgb)
combined, combined_alpha = over(linear(east_rgba[:, :, :3]), east_rgba[:, :, 3], base_rgb, alpha)
foreground = alpha * smooth((np.abs(azimuth) - 45) / 13)
combined, combined_alpha = over(base_rgb, foreground, combined, combined_alpha)
combined_alpha *= 1 - smooth((v - .85) / .15)
rgba = np.rint(np.clip(np.dstack((encoded(combined), combined_alpha)), 0, 1) * 255).astype(np.uint8)
rgba[[0, -1], :, 3] = 0
rgba[:, -1] = rgba[:, 0]
output = Image.fromarray(rgba)
output.save(args.output, quality=92, alpha_quality=100, method=6, exact=True)
low = args.output.with_stem(args.output.stem + '-low')
low_rgba = np.asarray(output.resize((2048, 288), Image.Resampling.LANCZOS)).copy()
low_rgba[[0, -1], :, 3] = 0
low_rgba[:, -1] = low_rgba[:, 0]
Image.fromarray(low_rgba).save(low, quality=90, alpha_quality=100, method=6, exact=True)
print('rotation / seam loss / native seam and centre elevations:', best)
for path in [args.output, low]:
    print(path, path.stat().st_size)
