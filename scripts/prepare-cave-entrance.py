"""Prepare the CC BY Rocky cave entrance, baking its native 1K atlas as macro tint."""
import argparse
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pymeshlab
import trimesh
from PIL import ImageFilter
from scipy.spatial import cKDTree
from trimesh.visual.color import uv_to_color

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
UID = '6b0765f8887a47e1b0a063a118293c83'
DEFAULT_FIT = {
    'uniformScale': .0152,
    'sourceInward': [.29499922562804903, 0, -.9554974918223759],
    'sourceSide': [-.9554974918223759, 0, -.29499922562804903],
    'sourceAnchor': [-39.787395558223814, -284.5132842324385, -294.8592259955474],
    'tubeIndex': 0, 'radialRmsMetres': .3010107187558363,
}


def section(mesh, origin, side, scale):
    angles = np.arange(64) * np.pi / 32
    directions = np.array(side)[None, :] * np.cos(angles[:, None])
    directions[:, 1] = np.sin(angles)
    origins = np.tile(origin, (64, 1))
    points, rays, _ = mesh.ray.intersects_location(origins, directions, multiple_hits=True)
    radius = np.full(64, np.inf)
    distance = np.linalg.norm(points - origins[rays], axis=1)
    valid = distance > 1
    np.minimum.at(radius, rays[valid], distance[valid])
    if not np.isfinite(radius).all():
        raise ValueError('The selected natural entrance section is not enclosed')
    return radius * scale


def coarsen_body(mesh, colors, route):
    centers = mesh.triangles_center
    nearest = cKDTree(route[:, [0, 2]]).query(centers[:, [0, 2]])[1]
    floor = (mesh.face_normals[:, 1] > .2) & (np.abs(centers[:, 1] - route[nearest, 1]) < 1.3)
    ends = np.minimum(np.linalg.norm(centers - route[0], axis=1), np.linalg.norm(centers - route[-1], axis=1)) < 6
    protected = floor | ends
    fixed = mesh.submesh([protected], append=True)
    walls = mesh.submesh([~protected], append=True)
    walls.merge_vertices(digits_vertex=5)
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(vertex_matrix=walls.vertices, face_matrix=walls.faces))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=60000, preserveboundary=True,
                                               preservenormal=True, boundaryweight=100, qualitythr=.5)
    reduced = ms.current_mesh()
    walls = trimesh.Trimesh(reduced.vertex_matrix(), reduced.face_matrix(), process=False)
    result = trimesh.util.concatenate([fixed, walls])
    tint = colors[cKDTree(mesh.vertices).query(result.vertices)[1]]
    return result, tint, {'sourceTriangles': len(mesh.faces), 'protectedTriangles': int(protected.sum()),
                          'webTriangles': len(result.faces), 'wallTargetTriangles': 60000,
                          'protectedMouthRadiusMetres': 6, 'bodyShade': False}


def prepare(source, fit, tube_source):
    spec = importlib.util.spec_from_file_location('prepare_cave', ROOT / 'scripts/prepare-cave.py')
    pipeline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pipeline)
    scene = trimesh.load(source, force='scene', process=False)
    parts, tint = [], []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        part = scene.geometry[name].copy()
        image = part.visual.material.baseColorTexture.convert('RGB')
        if image.size != (1024, 1024):
            raise ValueError('Expected the approved native 1K atlas')
        tint.append(pipeline.linear(uv_to_color(part.visual.uv, image.filter(ImageFilter.GaussianBlur(2)))[:, :3] / 255))
        part.visual = trimesh.visual.ColorVisuals(part)
        part.apply_transform(transform)
        parts.append(part)
    mesh = trimesh.util.concatenate(parts)
    source_triangles = len(mesh.faces)
    source_points, source_tint = mesh.vertices.copy(), np.concatenate(tint)
    mesh.merge_vertices(digits_vertex=5)
    opening = section(mesh, np.array(fit['sourceInward']) * 190 + np.array(fit['sourceSide']) * 150 + [0, -160, 0], fit['sourceSide'], fit['uniformScale'])
    neck = section(mesh, np.array(fit['sourceAnchor']) + [0, 1.1 / fit['uniformScale'], 0], fit['sourceSide'], fit['uniformScale'])
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=70000, preserveboundary=True,
                                               preservenormal=True, boundaryweight=10, qualitythr=.5)
    simplified = ms.current_mesh()
    mesh = trimesh.Trimesh(simplified.vertex_matrix(), simplified.face_matrix(), process=False)
    colors = source_tint[cKDTree(source_points).query(mesh.vertices)[1]]
    data = json.loads((ROOT / 'src/cave/cave-data.json').read_text())
    mouth_fit = json.loads((ROOT / 'public/cave/mouth-fit.json').read_text())
    anchor = np.array(fit['sourceAnchor'])
    forward = np.array(fit['sourceInward'])
    target = np.array(mouth_fit['volume']['route'][fit['tubeIndex']])
    target[1] -= .5
    inward = -np.array(data['mouths'][0]['outward'])
    yaw = np.arctan2(inward[0], inward[2]) - np.arctan2(forward[0], forward[2])
    rotation = trimesh.transformations.rotation_matrix(yaw, [0, 1, 0])[:3, :3]
    scale = fit['uniformScale']
    source_depth = (mesh.vertices - anchor) @ forward * scale
    mesh.vertices = (mesh.vertices - anchor) @ rotation.T * scale + target
    side = np.array([inward[2], 0, -inward[0]])
    lateral = (mesh.vertices - target) @ side
    triangles = mesh.triangles
    floor = (np.abs(mesh.face_normals[:, 1]) > .2) & (triangles[:, :, 1].mean(axis=1) < 1.3)
    path = (lateral[mesh.faces].min(axis=1) < 1.2) & (lateral[mesh.faces].max(axis=1) > -1.2)
    volume = mouth_fit['volume']
    centers = mesh.triangles_center
    profile = cKDTree(np.array(volume['route'])[:, [0, 2]]).query(centers[:, [0, 2]])[1]
    delta = centers - np.array(volume['route'])[profile]
    x = np.sum(delta * np.array(volume['side'])[profile], axis=1)
    y = delta[:, 1] - volume['axisHeight']
    angle = np.arctan2(y, x) % (2 * np.pi) * 64 / (2 * np.pi)
    lo = np.floor(angle).astype(int) % 64
    radii = np.array(volume['radius'])
    radius = radii[profile, lo] * (1 - angle % 1) + radii[profile, (lo + 1) % 64] * (angle % 1)
    roof = (centers[:, 1] > 2.05) & (mesh.face_normals[:, 1] < -.25)
    back = (source_depth[mesh.faces].mean(axis=1) > .6) & (np.hypot(x, y) < radius + .05) & ~roof
    keep = ~(back | (floor & path))
    mesh.update_faces(keep)
    mesh.update_faces(mesh.nondegenerate_faces(height=1e-6))
    tube_path = ROOT / 'public/cave/cave-fitted.glb'
    raw = tube_source.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + length])
    primitive = document['meshes'][0]['primitives'][0]
    position = document['accessors'][primitive['attributes']['POSITION']]
    position_view = document['bufferViews'][position['bufferView']]
    points = np.ndarray((position['count'], 3), dtype='<u2', buffer=raw,
                        offset=28 + length + position_view.get('byteOffset', 0),
                        strides=(position_view['byteStride'], 2)).astype(float) / 65535
    node = document['nodes'][0]
    points = points * np.array(node['scale']) + np.array(node['translation'])
    indices = document['accessors'][primitive['indices']]
    index_view = document['bufferViews'][indices['bufferView']]
    faces = np.frombuffer(raw, dtype='<u4', count=indices['count'], offset=28 + length + index_view.get('byteOffset', 0))
    tube = trimesh.Trimesh(points, faces.reshape(-1, 3), process=False)
    attribute = document['accessors'][document['meshes'][0]['primitives'][0]['attributes']['COLOR_0']]
    view = document['bufferViews'][attribute['bufferView']]
    tube_tint = np.ndarray((attribute['count'], 3), dtype=np.uint8, buffer=raw,
                           offset=28 + length + view.get('byteOffset', 0) + attribute.get('byteOffset', 0),
                           strides=(view.get('byteStride', 3), 1)) / 255
    tube_depth = (tube.triangles_center - np.array(data['mouths'][0]['floorCenter'])) @ inward
    tube_floor = (tube.face_normals[:, 1] > .45) & (tube.triangles[:, :, 1].max(axis=1) < .8)
    tube.update_faces((tube_depth > .25) | tube_floor)
    tube, tube_tint, reduction = coarsen_body(tube, tube_tint, np.array(data['route']))
    pipeline.export_glb(tube_path, tube, tube_tint, np.array(data['route']))
    blend = np.clip((source_depth + .35) / .75, 0, 1)[:, None]
    nearest = cKDTree(tube.vertices).query(mesh.vertices)[1]
    colors = colors * (1 - blend) + tube_tint[nearest] * blend
    used, faces = np.unique(mesh.faces, return_inverse=True)
    mesh = trimesh.Trimesh(mesh.vertices[used], faces.reshape(-1, 3), process=False)
    colors = colors[used]
    normals = mesh.vertex_normals.copy()
    for vertex in np.flatnonzero(np.linalg.norm(normals, axis=1) < .5):
        adjacent = np.flatnonzero((mesh.faces == vertex).any(axis=1))
        if len(adjacent):
            normals[vertex] = mesh.face_normals[adjacent[np.argmax(mesh.area_faces[adjacent])]]
    mesh.vertex_normals = normals
    inside = (1 - np.clip((np.abs(lateral[used]) - 2.1), 0, 1)) * (1 - np.clip((mesh.vertices[:, 1] - 3.3) / .6, 0, 1))
    distance, neighbours = cKDTree(mesh.vertices).query(mesh.vertices, k=32, distance_upper_bound=.6)
    weight = np.exp(-distance ** 2 / .45 ** 2)
    smooth_y = (np.r_[normals[:, 1], 0][neighbours] * weight).sum(axis=1) / weight.sum(axis=1)
    ceiling = np.clip((-smooth_y - .05) / .15, 0, 1)
    shade = 1 - .9 * inside * ceiling * np.clip((source_depth[used] + 1.4) / .8, 0, 1) * np.clip((mesh.vertices[:, 1] - .8) / .8, 0, 1)
    hill = trimesh.load(ROOT / 'public/cave/outcrop.glb', force='scene', process=False).to_mesh()
    hill_colors = hill.visual.vertex_colors[:, :3] / 255
    hill_center = (hill.bounds[0] + hill.bounds[1]) / 2
    hill.vertices = (hill.vertices - hill_center) @ rotation.T * .24
    hill.vertices[:, 1] += mesh.bounds[1, 1] + .6 - hill.bounds[1, 1]
    hill.vertices[:, [0, 2]] += (target + inward * 4)[[0, 2]]
    colors = np.concatenate([colors, hill_colors])
    shade = np.concatenate([shade, np.ones(len(hill.vertices))])
    mesh = trimesh.util.concatenate([mesh, hill])
    pipeline.export_glb(ROOT / 'public/cave/mouth-forest.glb', mesh, colors, np.array(data['route']),
                        copyright='Rocky cave entrance, Nature-témoin / speleotv, CC BY 4.0; Coastal Cliff 01, Poly Haven, CC0', shade=shade)
    report = {**fit, 'mouth': 'forest', 'source': {'uid': UID, 'author': 'Nature-témoin / speleotv',
              'url': f'https://sketchfab.com/3d-models/rocky-cave-entrance-{UID}', 'license': 'CC BY 4.0',
              'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'triangles': source_triangles,
              'atlasResolution': [1024, 1024], 'atlasUse': 'blurred macro vertex tint, not upscaled'},
              'overlapMetres': .35, 'tubeCutDepthMetres': .25, 'neckEndMetres': .6,
              'seatingOffsetMetres': -.5, 'retainedRoofOverlap': True, 'rockTriangles': len(mesh.faces), 'createdFaces': 0,
              'bodyReduction': reduction, 'ceilingShadeStartMetres': -1.4, 'ceilingShadeSmoothRadiusMetres': .6,
              'hillside': {'source': 'https://polyhaven.com/a/coastal_cliff_01', 'license': 'CC0', 'uniformScale': .24,
                          'triangles': len(hill.faces), 'bounds': hill.bounds.tolist()},
              'removedBackTriangles': int(back.sum()), 'removedPathFloorTriangles': int((floor & path).sum()),
              'rotationY': float(yaw), 'targetAnchor': target.tolist(),
              'openingWidthMetres': float(opening[0] + opening[32]), 'openingHeightMetres': float(opening[16] + opening[48]),
              'neckWidthMetres': float(neck[0] + neck[32]), 'neckHeightMetres': float(neck[16] + neck[48]),
              'apertureGuards': mouth_fit['mouths'][0]['apertureGuards']}
    mouth_fit['mouths'][0] = report
    (ROOT / 'public/cave/mouth-fit.json').write_text(json.dumps(mouth_fit, separators=(',', ':')))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--fit', type=Path)
    parser.add_argument('--tube-source', type=Path, default=ROOT / 'public/cave/cave-fitted.glb')
    args = parser.parse_args()
    prepare(args.source, json.loads(args.fit.read_text()) if args.fit else DEFAULT_FIT, args.tube_source)
