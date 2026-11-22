#!/usr/bin/env python3
"""Lower the existing scanned hillside to overlap the entrance roof."""
import argparse
import importlib.util
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pipeline', ROOT / 'scripts/prepare-cave.py')
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


def seat(source, sink):
    data = source.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + length])
    primitive = document['meshes'][0]['primitives'][0]

    def attribute(index):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        dtype = {5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[accessor['componentType']]
        width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        item = np.dtype(dtype).itemsize
        values = np.ndarray((accessor['count'], width), dtype=dtype, buffer=data,
                            offset=28 + length + view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                            strides=(view.get('byteStride', width * item), item)).astype(float)
        return values / (255 if dtype == 'u1' else 65535) if accessor.get('normalized') else values

    node = document['nodes'][0]
    vertices = attribute(primitive['attributes']['POSITION']) * node.get('scale', [1, 1, 1]) + node.get('translation', [0, 0, 0])
    faces = attribute(primitive['indices']).astype(int).reshape(-1, 3)
    colors = attribute(primitive['attributes']['COLOR_0'])[:, :3]
    shade = attribute(primitive['attributes']['_CAVE_SHADE']).ravel()
    fit = json.loads((ROOT / 'public/cave/mouth-fit.json').read_text())
    hillside = fit['mouths'][0]['hillside']
    used = np.unique(faces[-hillside['triangles']:])
    vertices[used, 1] -= sink
    mesh = trimesh.Trimesh(vertices, faces, process=False)
    normals = mesh.vertex_normals.copy()
    normals[np.linalg.norm(normals, axis=1) < .5] = [0, 1, 0]
    mesh.vertex_normals = normals
    route = np.array(json.loads((ROOT / 'src/cave/cave-data.json').read_text())['route'])
    output = ROOT / 'public/cave/mouth-forest.glb'
    pipeline.export_glb(output, mesh, colors, route, shade=shade,
                        copyright='Rocky cave entrance, Nature-témoin / speleotv, CC BY 4.0; Coastal Cliff 01, Poly Haven, CC0')
    hillside['seatingSinkMetres'] = sink
    hillside['bounds'] = [vertices[used].min(axis=0).tolist(), vertices[used].max(axis=0).tolist()]
    fit['mouths'][0]['webBytes'] = output.stat().st_size
    (ROOT / 'public/cave/mouth-fit.json').write_text(json.dumps(fit, separators=(',', ':')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--sink', type=float, default=4)
    args = parser.parse_args()
    if not np.isfinite(args.sink) or args.sink < 0:
        parser.error('--sink must be a finite non-negative distance')
    seat(args.source, args.sink)
