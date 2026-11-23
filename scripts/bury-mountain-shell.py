"""Lower the existing scanned wrap's low flanks into the native ground; preserve its roof."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def bury(vertices, route, mouth, burial=1.5):
    if not np.isfinite(burial) or burial < 0:
        raise ValueError('Burial must be finite and non-negative')
    result = np.array(vertices, dtype=float, copy=True)
    if not len(result):
        return result
    route = np.asarray(route)
    if route.ndim != 2 or route.shape[1] != 3 or len(route) < 2:
        raise ValueError('Burial requires a floor route')
    distance = np.full(len(result), np.inf)
    for a, b in zip(route[:-1], route[1:]):
        direction = (b - a)[[0, 2]]
        run = direction @ direction
        t = np.clip((result[:, [0, 2]] - a[[0, 2]]) @ direction / run, 0, 1) if run else np.zeros(len(result))
        distance = np.minimum(distance, np.linalg.norm(result[:, [0, 2]] - a[[0, 2]] - t[:, None] * direction, axis=1))
    height = result[:, 1] - mouth['floorCenter'][1]
    weight = np.clip((1.5 - height) / 1.0, 0, 1)
    weight *= distance > .85
    result[:, 1] -= burial * weight
    return result


def prepare(source, burial=1.5):
    raw = source.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + length])
    primitive = document['meshes'][0]['primitives'][0]

    def attribute(index, dtype, size, divisor=1):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        itemsize = np.dtype(dtype).itemsize
        return np.ndarray((accessor['count'], size), dtype=dtype, buffer=raw,
                          offset=28 + length + view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                          strides=(view.get('byteStride', size * itemsize), itemsize)).astype(float) / divisor

    node = document['nodes'][0]
    vertices = attribute(primitive['attributes']['POSITION'], '<u2', 3, 65535) * node['scale'] + node['translation']
    colors = attribute(primitive['attributes']['COLOR_0'], 'u1', 3, 255)
    faces = attribute(primitive['indices'], '<u4', 1).astype(int).reshape(-1, 3)
    data = json.loads((ROOT / 'src/cave/cave-data.json').read_text())
    lowered = bury(vertices, data['route'], data['mouths'][1], burial)
    mesh = trimesh.Trimesh(lowered, faces, process=False)
    normals = mesh.vertex_normals.copy()
    normals[np.linalg.norm(normals, axis=1) < .5] = [0, 1, 0]
    mesh.vertex_normals = normals
    spec = importlib.util.spec_from_file_location('pipeline', ROOT / 'scripts/prepare-cave.py')
    pipeline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pipeline)
    output = ROOT / 'public/cave/mouth-mountain.glb'
    pipeline.export_glb(output, mesh, colors, np.array(data['route']), copyright='Coastal Cliff 04, Poly Haven, CC0')
    fit_path = ROOT / 'public/cave/mouth-fit.json'
    fit = json.loads(fit_path.read_text())
    fit['mouths'][1]['scannedShell']['floorEdgeBurial'] = {
        'sourceSha256': hashlib.sha256(raw).hexdigest(), 'maximumLoweringMetres': burial,
        'unchangedAboveFloorMetres': 1.5, 'protectedRouteRadiusMetres': .85,
        'loweredVertices': int(np.count_nonzero(lowered[:, 1] != vertices[:, 1])), 'createdFaces': 0}
    fit['mouths'][1]['scannedShell']['webBytes'] = output.stat().st_size
    fit_path.write_text(json.dumps(fit, separators=(',', ':')))
    print(json.dumps(fit['mouths'][1]['scannedShell']['floorEdgeBurial']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--burial', type=float, default=1.5)
    args = parser.parse_args()
    prepare(args.source, args.burial)
