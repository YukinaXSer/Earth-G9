"""Keep the 2K photographic detail in GPU-native ETC2/EAC, without a runtime codec.

Authoring: Pillow, NumPy, etcpak==0.9.15, texture2ddecoder==1.0.6.
Run after build-banyan-grain.py. Both ETC2 codecs use BGRA input.
"""
import json
import struct
from pathlib import Path

import etcpak
import numpy as np
import texture2ddecoder
from PIL import Image


root = Path(__file__).resolve().parents[1] / 'public' / 'textures'


def write_texture(kind):
    image = Image.open(root / f'near-banyan-{kind}.jpg').convert('RGB')
    pixels = np.asarray(image, dtype=np.float32) / 255
    normal = kind == 'normal'
    if normal:
        pixels = pixels * 2 - 1
        pixels /= np.linalg.norm(pixels, axis=2, keepdims=True)
        if np.any(pixels[:, :, 2] <= 0):
            raise ValueError('Expected upper-hemisphere photographic normals')
    else:
        pixels = np.where(pixels <= .04045, pixels / 12.92, ((pixels + .055) / 1.055) ** 2.4)
    width, height = image.size
    if width != height or width & (width - 1):
        raise ValueError('Expected square power-of-two source')
    levels, decoded = [], None
    while True:
        h, w = pixels.shape[:2]
        rgba = np.full((h, w, 4), 255, dtype=np.uint8)
        if normal:
            octahedral = pixels / np.abs(pixels).sum(axis=2, keepdims=True)
            xy = np.round((octahedral[:, :, :2] * .5 + .5) * 255).clip(0, 255)
            rgba[:, :, :3] = xy[:, :, 1, None]
            rgba[:, :, 3] = xy[:, :, 0]
            order, encode, decode, block_bytes = 'BGRA', etcpak.compress_etc2_rgba, texture2ddecoder.decode_etc2a8, 16
        else:
            srgb = np.where(pixels <= .0031308, pixels * 12.92, 1.055 * pixels ** (1 / 2.4) - .055)
            rgba[:, :, :3] = np.round(srgb * 255).clip(0, 255)
            order, encode, decode, block_bytes = 'BGRA', etcpak.compress_etc2_rgb, texture2ddecoder.decode_etc2, 8
        # CompressedTexture cannot flip on upload; match the original TextureLoader flipY.
        stored = np.flipud(rgba)
        stored = np.pad(stored, ((0, max(0, 4 - h)), (0, max(0, 4 - w)), (0, 0)), mode='edge')
        raw = Image.fromarray(stored).tobytes('raw', order)
        block = encode(raw, max(4, w), max(4, h))
        assert len(block) == ((w + 3) // 4) * ((h + 3) // 4) * block_bytes
        levels.append(block)
        if decoded is None:
            decoded = np.asarray(Image.frombytes('RGBA', (w, h), decode(block, w, h), 'raw', 'BGRA'), dtype=np.float32)[::-1] / 255
        if w == 1:
            break
        pixels = pixels.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
        if normal:
            pixels /= np.linalg.norm(pixels, axis=2, keepdims=True)
    header = b'\xabKTX 11\xbb\r\n\x1a\n' + struct.pack('<13I',
        0x04030201, 0, 1, 0, 0x9278 if normal else 0x9274,
        0x1908 if normal else 0x1907, width, height, 0, 0, 1, len(levels), 0)
    output = root / f'near-banyan-{kind}.ktx'
    output.write_bytes(header + b''.join(struct.pack('<I', len(b)) + b + b'\0' * (-len(b) % 4) for b in levels))
    if normal:
        xy = decoded[:, :, [3, 1]] * 2 - 1
        restored = np.dstack((xy, np.maximum(1 - np.abs(xy).sum(axis=2), .0001)))
        original = np.asarray(image, dtype=np.float32) / 127.5 - 1
        for n in (restored, original):
            n[:, :, :2] *= .12
            n /= np.linalg.norm(n, axis=2, keepdims=True)
        angle = np.degrees(np.arccos(np.clip((restored * original).sum(axis=2), -1, 1)))
        error = {'normalDegreesMean': float(angle.mean()), 'normalDegreesP99': float(np.percentile(angle, 99))}
    else:
        original = np.asarray(image, dtype=np.float32) / 255
        error = {'rgbMeanAbsoluteError': float(np.abs(decoded[:, :, :3] - original).mean())}
    print(json.dumps({'file': output.name, 'width': width, 'height': height, 'mips': len(levels),
                      'gpuBytes': sum(map(len, levels)), **error}))


for kind in ('color', 'normal'):
    write_texture(kind)
