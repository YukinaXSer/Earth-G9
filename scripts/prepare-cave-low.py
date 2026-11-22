"""Generate UV-preserving low-tier geometry from the already bundled forest scans."""
import argparse
import json
import struct
import subprocess
from pathlib import Path

import numpy as np
import pymeshlab

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:4173')
args = parser.parse_args()
records = json.loads(subprocess.check_output(['node', str(ROOT / 'src/cave/prepare-low-data.mjs'), args.base_url]))
gltf = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [], 'bufferViews': [], 'accessors': []}
binary = bytearray()


def accessor(values, kind, component=5126):
    values = np.asarray(values, dtype='<f4' if component == 5126 else '<u4')
    while len(binary) % 4:
        binary.append(0)
    view = len(gltf['bufferViews'])
    gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': values.nbytes})
    binary.extend(values.tobytes())
    result = {'bufferView': view, 'componentType': component, 'count': len(values), 'type': kind}
    if kind == 'VEC3':
        result.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
    gltf['accessors'].append(result)
    return len(gltf['accessors']) - 1


for record in records:
    a = record['attributes']
    vertices, faces = np.array(a['position']), np.array(record['indices']).reshape(-1, 3)
    options = {'vertex_matrix': vertices, 'face_matrix': faces}
    if 'uv' in a:
        options['v_tex_coords_matrix'] = np.array(a['uv'])
    if 'color' in a:
        color = np.array(a['color'])
        options['v_color_matrix'] = np.column_stack([color, np.ones(len(color))]) if color.shape[1] == 3 else color
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(**options))
    target = max(64, int(len(faces) * .06))
    if 'uv' in a:
        ms.compute_texcoord_transfer_vertex_to_wedge()
        ms.meshing_remove_duplicate_vertices()
        ms.meshing_decimation_quadric_edge_collapse_with_texture(targetfacenum=target, preservenormal=True, preserveboundary=False)
    else:
        ms.meshing_decimation_quadric_edge_collapse(targetfacenum=target, preservenormal=True, preservetopology=True, preserveboundary=True)
    reduced = ms.current_mesh()
    ids = reduced.face_matrix().reshape(-1)
    attributes = {'POSITION': accessor(reduced.vertex_matrix()[ids], 'VEC3'), 'NORMAL': accessor(reduced.vertex_normal_matrix()[ids], 'VEC3')}
    if 'uv' in a:
        attributes['TEXCOORD_0'] = accessor(reduced.wedge_tex_coord_matrix(), 'VEC2')
    if 'color' in a:
        attributes['COLOR_0'] = accessor(reduced.vertex_color_matrix()[ids], 'VEC4')
    indices = accessor(np.arange(len(ids)), 'SCALAR', 5125)
    gltf['scenes'][0]['nodes'].append(len(gltf['nodes']))
    gltf['nodes'].append({'mesh': len(gltf['meshes']), 'name': record['name']})
    gltf['meshes'].append({'primitives': [{'attributes': attributes, 'indices': indices}]})
    print(record['name'], len(faces), '->', len(ids) // 3, flush=True)

gltf['buffers'] = [{'byteLength': len(binary)}]
metadata = json.dumps(gltf, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
binary += b'\0' * (-len(binary) % 4)
blob = struct.pack('<III', 0x46546c67, 2, 28 + len(metadata) + len(binary)) + struct.pack('<II', len(metadata), 0x4e4f534a) + metadata + struct.pack('<II', len(binary), 0x004e4942) + binary
path = ROOT / 'public/cave/forest-low.glb'
path.write_bytes(blob)
print(path.name, len(blob), 'bytes')
