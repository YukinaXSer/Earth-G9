"""Recess the scanned passage inside the host's native cliff, without cap faces."""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys

import numpy as np
import trimesh

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/cave'


def recess_faces(mesh, mouth, recess):
    if not np.isfinite(recess) or recess < 0:
        raise ValueError('Recess must be finite and non-negative')
    center = np.array(mouth['floorCenter'])
    depth = (mesh.triangles - center) @ np.array(mouth['outward'])
    floor = (mesh.face_normals[:, 1] > .2) & (abs(mesh.triangles_center[:, 1] - center[1]) < 1.3)
    return (depth.max(axis=1) <= -recess) | floor


def prepare(source, recess=1.75):
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
    positions = attribute(primitive['attributes']['POSITION'], '<u2', 3, 65535)
    positions = positions * node['scale'] + node['translation']
    colors = attribute(primitive['attributes']['COLOR_0'], 'u1', 3, 255)
    faces = attribute(primitive['indices'], '<u4', 1).astype(int).reshape(-1, 3)
    mesh = trimesh.Trimesh(positions, faces, process=False)
    data = json.loads((ROOT / 'src/cave/cave-data.json').read_text())
    mouth = data['mouths'][1]
    mesh.update_faces(recess_faces(mesh, mouth, recess))
    used, inverse = np.unique(mesh.faces, return_inverse=True)
    mesh = trimesh.Trimesh(positions[used], inverse.reshape(-1, 3), process=False)
    normals = np.array(mesh.vertex_normals)
    normals[np.linalg.norm(normals, axis=1) < .5] = [0, 1, 0]
    mesh.vertex_normals = normals
    spec = importlib.util.spec_from_file_location('pipeline', ROOT / 'scripts/prepare-cave.py')
    pipeline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pipeline)
    pipeline.export_glb(PUBLIC / 'cave-fitted.glb', mesh, colors[used], np.array(data['route']))
    empty = {'asset': {'version': '2.0', 'copyright': 'No fitted mountain outcrop'},
             'scene': 0, 'scenes': [{'nodes': []}], 'nodes': []}
    header = json.dumps(empty).encode()
    header += b' ' * (-len(header) % 4)
    (PUBLIC / 'mouth-mountain.glb').write_bytes(struct.pack('<IIIII', 0x46546c67, 2, 20 + len(header), len(header), 0x4e4f534a) + header)
    fit = json.loads((PUBLIC / 'mouth-fit.json').read_text())
    guards = fit['mouths'][1]['apertureGuards']
    fit['mouths'][1] = {'mouth': 'mountain', 'strategy': 'native-cliff',
                        'source': {'url': 'https://polyhaven.com/a/coastal_cliff_04', 'license': 'CC0',
                                   'use': 'Existing host scanned cliff, tiles and grounded scan rocks'},
                        'createdFaces': 0, 'rockTriangles': 0, 'tubeRecessMetres': recess,
                        'tubeRecessCriterion': 'all non-floor triangle vertices behind recess plane',
                        'nativeOpeningExtensionMetres': 1.5, 'tubeTrianglesBeforeRecess': len(faces),
                        'tubeTrianglesAfterRecess': len(mesh.faces), 'apertureGuards': guards}
    fit['mouths'][0]['bodyReduction']['webTriangles'] = len(mesh.faces)
    fit['mouths'][0]['bodyReduction']['mountainRecessMetres'] = recess
    (PUBLIC / 'mouth-fit.json').write_text(json.dumps(fit, separators=(',', ':')))
    print(json.dumps(fit['mouths'][1], indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--recess', type=float, default=1.75)
    args = parser.parse_args()
    prepare(args.source, args.recess)
