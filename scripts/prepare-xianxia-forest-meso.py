"""Replace only photographic ground meso maps with native GPU blocks, offline."""
import argparse
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('manifest', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--asset', default='forest_leaves_02')
parser.add_argument('--toktx', default='toktx')
parser.add_argument('--ktx', default='ktx')
args = parser.parse_args()
info = json.loads((args.source / (args.asset + '.json')).read_text())
meters = info['dimensions'][0] / 1000
manifest = json.loads(args.manifest.read_text())
color = Image.open(args.source / (args.asset + '_diff_4k.jpg')).convert('RGB')
normal = Image.open(args.source / (args.asset + '_nor_gl_4k.jpg')).convert('RGB')
rough = Image.open(args.source / (args.asset + '_rough_2k.jpg')).convert('L')
assert color.width >= 2048 and normal.width >= 1024 and rough.width >= 1024
source_pixels = color.width
color = color.resize((2048, 2048), Image.Resampling.LANCZOS)
normal = normal.resize((1024, 1024), Image.Resampling.LANCZOS)
values = np.asarray(normal, dtype=np.float32) / 127.5 - 1
values /= np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), .0001)
normal = Image.fromarray(np.uint8(np.clip(values * .5 + .5, 0, 1) * 255))
normal.putalpha(rough.resize((1024, 1024), Image.Resampling.LANCZOS))
for channel, image in [('Color', color), ('Normal', normal)]:
    stem = 'ground-' + args.asset.replace('_', '-') + '-' + channel.lower()
    png = args.output / (stem + '.png')
    image.save(png)
    basis = args.output / (stem + '.ktx2')
    subprocess.run([args.toktx, '--t2', '--genmipmap', '--threads', '4',
                    '--lower_left_maps_to_s0t0', '--assign_oetf',
                    'srgb' if channel == 'Color' else 'linear',
                    '--encode', 'uastc', '--uastc_quality', '2', str(basis), str(png)], check=True)
    for variant in ['etc2', 's3tc']:
        target = ('etc-rgb' if channel == 'Color' else 'etc-rgba') if variant == 'etc2' else ('bc1' if channel == 'Color' else 'bc3')
        name = variant + '-' + basis.name
        destination = args.output / name
        subprocess.run([args.ktx, 'transcode', '--target', target, str(basis), str(destination)], check=True)
        content = destination.read_bytes()
        manifest['variants'][variant]['textures']['groundMeso' + channel] = dict(
            file=name, width=image.width, height=image.height, bytes=len(content),
            gzipBytes=len(gzip.compress(content, compresslevel=6, mtime=0)),
            source=args.asset, sourceUrl='https://polyhaven.com/a/' + args.asset,
            license='CC0', author=info['authors'], physicalTileMeters=meters,
            sourcePhysicalMeters=meters, sourcePixels=source_pixels,
            sourceRectPixels=[0, 0, source_pixels, source_pixels],
            roughnessSourcePixels=rough.width if channel == 'Normal' else None,
            encoding=target, vkFormat=int.from_bytes(content[12:16], 'little'),
            supercompression=0, sha256=hashlib.sha256(content).hexdigest())
for variant in manifest['variants'].values():
    variant['textureFileBytes'] = sum(row['bytes'] for row in variant['textures'].values())
    variant['gzipTextureBytes'] = sum(row['gzipBytes'] for row in variant['textures'].values())
manifest['textures'] = manifest['variants']['etc2']['textures']
manifest['method'] = ('Full native-scale mossy Forest Leaves 02 photograph for ground meso color/GL normal/roughness; '
                      'existing Forest Floor fine grain and captured rock maps unchanged. '
                      'Only offline GPU block transcode; no runtime decoder or geometry changes.')
(args.output / 'manifest-high.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('GROUND MESO', meters, 'meters; native 2048 color / 1024 normal+roughness')
