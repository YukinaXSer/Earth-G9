"""Offline GPU transcode; no Basis worker, eval, or WASM ships to the browser."""
import argparse
import gzip
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path, help='Directory containing micro-manifest.json and the approved ground KTX2 files')
parser.add_argument('output', type=Path)
parser.add_argument('--ktx', default='ktx')
args = parser.parse_args()
source = json.loads((args.source / 'micro-manifest.json').read_text())
manifest = {'method': 'Full photographic meso + native grain for captured ground and wall. Offline GPU blocks, no runtime Basis/WASM/eval. Geometry unchanged.', 'groundMean': source['groundMean'], 'wallMean': source['wallMean'], 'variants': {}}
for variant in ['etc2', 's3tc']:
    textures = {}
    for name, original in source['textures'].items():
        target = ('etc-rgb' if name.endswith('Color') else 'etc-rgba') if variant == 'etc2' else ('bc1' if name.endswith('Color') else 'bc3')
        filename = f'{variant}-{original["file"]}'
        destination = args.output / filename
        subprocess.run([args.ktx, 'transcode', '--target', target, str(args.source / 'textures' / original['file']), str(destination)], check=True)
        data = destination.read_bytes()
        textures[name] = {**original, 'file': filename, 'bytes': len(data), 'gzipBytes': len(gzip.compress(data, compresslevel=6, mtime=0)), 'encoding': target, 'vkFormat': int.from_bytes(data[12:16], 'little'), 'supercompression': 0}
    manifest['variants'][variant] = {'textures': textures, 'textureFileBytes': sum(t['bytes'] for t in textures.values()), 'gzipTextureBytes': sum(t['gzipBytes'] for t in textures.values())}
manifest['textures'] = manifest['variants']['etc2']['textures']
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
for name, variant in manifest['variants'].items():
    print(name, variant['textureFileBytes'], 'file bytes;', variant['gzipTextureBytes'], 'gzip bytes')
