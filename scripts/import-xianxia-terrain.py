"""Import measured Huangshan relief and CC-BY 2016 Sentinel imagery.

Requires numpy, Pillow and requests. Pass an existing download cache directory.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image
import requests

root = Path(__file__).resolve().parents[1]
cache = Path(sys.argv[1])
latitude, longitude = 30.119, 118.161
radius = 6378137
cosine = math.cos(math.radians(latitude))
origin_x = radius * math.radians(longitude)
origin_y = radius * math.asinh(math.tan(math.radians(latitude)))
half_world = math.pi * radius
sources = []


def tile(kind, zoom, x, y):
    url = (f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png'
           if kind == 'dem' else
           f'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{zoom}/{y}/{x}.jpg')
    path = cache / f'{kind}-{zoom}-{x}-{y}.png'
    if not path.exists():
        response = requests.get(url, timeout=45)
        response.raise_for_status()
        path.write_bytes(response.content)
    sources.append({'url': url, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return Image.open(path).convert('RGB')


dem = np.zeros((768, 768, 3), dtype=np.float64)
for x in range(3391, 3394):
    for y in range(1687, 1690):
        dem[(y-1687)*256:(y-1686)*256, (x-3391)*256:(x-3390)*256] = tile('dem', 12, x, y)
heights = dem[:, :, 0]*256 + dem[:, :, 1] + dem[:, :, 2]/256 - 32768
pixel = half_world*2/(4096*256)
step = pixel*cosine
left = ((3391*256+.5)*pixel-half_world-origin_x)*cosine
top = (origin_y-(half_world-(1687*256+.5)*pixel))*cosine
x0, x1 = math.floor((-1800-left)/step), math.ceil((2600-left)/step)
z0, z1 = math.floor((-2700-top)/step), math.ceil((1300-top)/step)
heights = heights[z0:z1+1, x0:x1+1]
photo = Image.new('RGB', (512, 512))
for x in (6784, 6785):
    for y in (3375, 3376):
        photo.paste(tile('sat2016', 13, x, y), ((x-6784)*256, (y-3375)*256))
photo.save(root/'public/xianxia/textures/huangshan-satellite.webp', quality=94)
photo_pixel = half_world*2/(8192*256)
data = {
    'origin': {'latitude': latitude, 'longitude': longitude},
    'x0': left+x0*step, 'z0': top+z0*step, 'step': step,
    'width': heights.shape[1], 'height': heights.shape[0],
    'heights': (np.round(heights*8)/8).ravel().tolist(),
    'satellite': {
        'x0': (6784*256*photo_pixel-half_world-origin_x)*cosine,
        'z0': (origin_y-(half_world-3375*256*photo_pixel))*cosine,
        'size': 512*photo_pixel*cosine,
    },
    'provenance': {
        'elevation': 'USGS SRTM, approximately 30 m native horizontal resolution; Mapzen Terrain Tiles',
        'imagery': 'EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0',
        'changes': 'Georeferenced crop, eighth-metre height quantization; no authored mountains or vertical exaggeration',
        'sources': sources,
    },
}
(root/'src/xianxia-terrain-data.json').write_text(json.dumps(data, separators=(',', ':')))
print(f'Imported {heights.shape} measured samples, elevations {heights.min():.1f}–{heights.max():.1f} m')
