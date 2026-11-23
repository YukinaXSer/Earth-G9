"""Delete unsupported scan islands while retaining grounded floor patches; add no faces."""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys

import numpy as np
from scipy.spatial import cKDTree
import trimesh

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def read_scan(path):
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + length])
    primitive = document['meshes'][0]['primitives'][0]

    def attribute(index):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        dtype = {5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[accessor['componentType']]
        width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        item = np.dtype(dtype).itemsize
        values = np.ndarray((accessor['count'], width), dtype=dtype, buffer=raw,
                            offset=28 + length + view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                            strides=(view.get('byteStride', width * item), item)).astype(float)
        return values / (255 if dtype == 'u1' else 65535) if accessor.get('normalized') else values

    node = document['nodes'][0]
    vertices = attribute(primitive['attributes']['POSITION']) * node['scale'] + node['translation']
    faces = attribute(primitive['indices']).astype(int).reshape(-1, 3)
    colors = attribute(primitive['attributes']['COLOR_0'])[:, :3]
    shade = attribute(primitive['attributes']['_CAVE_SHADE']).ravel() if '_CAVE_SHADE' in primitive['attributes'] else None
    return trimesh.Trimesh(vertices, faces, process=False), colors, shade


def components(mesh):
    return trimesh.graph.connected_components(mesh.face_adjacency, nodes=np.arange(len(mesh.faces)), min_len=1)


def supported_islands(mesh, support, minimum_area=.5, contact=.1):
    if minimum_area < 0 or contact < 0 or not np.isfinite([minimum_area, contact]).all():
        raise ValueError('Island thresholds must be finite and non-negative')
    keep = np.zeros(len(mesh.faces), dtype=bool)
    if not len(support):
        return keep
    tree = cKDTree(support)
    for ids in components(mesh):
        if mesh.area_faces[ids].sum() >= minimum_area:
            vertices = mesh.vertices[np.unique(mesh.faces[ids])]
            if tree.query(vertices, distance_upper_bound=contact)[0].min() <= contact:
                keep[ids] = True
    return keep


def entrance_islands(mesh, floor_height):
    keep = np.zeros(len(mesh.faces), dtype=bool)
    groups = components(mesh)
    if not groups:
        return keep
    keep[max(groups, key=lambda ids: mesh.area_faces[ids].sum())] = True
    for ids in groups:
        floor = (mesh.face_normals[ids, 1] > .2).any()
        grounded = mesh.triangles[ids, :, 1].min() <= floor_height + .1
        if floor and grounded and mesh.area_faces[ids].sum() >= .5:
            keep[ids] = True
    return keep


def prepare(source, body_source):
    mesh, colors, shade = read_scan(source)
    body, _, _ = read_scan(body_source)
    fit = json.loads((ROOT / 'public/cave/mouth-fit.json').read_text())
    data = json.loads((ROOT / 'src/cave/cave-data.json').read_text())
    source_fit = json.loads(source.with_name('mouth-fit.json').read_text())
    count = source_fit['mouths'][0]['hillside']['triangles']
    entrance = trimesh.Trimesh(mesh.vertices, mesh.faces[:-count], process=False)
    entrance_keep = entrance_islands(entrance, data['mouths'][0]['floorCenter'][1])
    support = np.concatenate([mesh.vertices[np.unique(entrance.faces[entrance_keep])], body.vertices])
    hill = trimesh.Trimesh(mesh.vertices, mesh.faces[-count:], process=False)
    hill_keep = supported_islands(hill, support)
    if not hill_keep.any():
        raise ValueError('No supported hillside fragments remain')
    keep = np.concatenate([entrance_keep, hill_keep])
    used, faces = np.unique(mesh.faces[keep], return_inverse=True)
    result = trimesh.Trimesh(mesh.vertices[used], faces.reshape(-1, 3), process=False)
    normals = result.vertex_normals.copy()
    normals[np.linalg.norm(normals, axis=1) < .5] = [0, 1, 0]
    result.vertex_normals = normals
    spec = importlib.util.spec_from_file_location('pipeline', ROOT / 'scripts/prepare-cave.py')
    pipeline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pipeline)
    output = ROOT / 'public/cave/mouth-forest.glb'
    pipeline.export_glb(output, result, colors[used], np.array(data['route']), shade=shade[used],
                        copyright='Rocky cave entrance, Nature-témoin / speleotv, CC BY 4.0; Coastal Cliff 01, Poly Haven, CC0')
    forest = fit['mouths'][0]
    forest['scanCleanup'] = {'createdFaces': 0, 'entranceTrianglesRemoved': int((~entrance_keep).sum()),
                             'hillsideTrianglesRemoved': int((~hill_keep).sum()),
                             'islandMinimumAreaSquareMetres': .5, 'islandContactMetres': .1}
    forest['hillside']['triangles'] = int(hill_keep.sum())
    forest['hillside']['bounds'] = [hill.triangles[hill_keep].reshape(-1, 3).min(axis=0).tolist(),
                                  hill.triangles[hill_keep].reshape(-1, 3).max(axis=0).tolist()]
    forest['rockTriangles'] = len(result.faces)
    forest['webBytes'] = output.stat().st_size
    (ROOT / 'public/cave/mouth-fit.json').write_text(json.dumps(fit, separators=(',', ':')))
    print(json.dumps(forest['scanCleanup']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--body-source', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source, args.body_source)
