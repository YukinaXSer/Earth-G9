"""Seat a uniformly scaled real cliff scan over the mountain cave shell; no cap faces."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import numpy as np
import trimesh

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


outcrop = module('outcrop', ROOT / 'src/cave/prepare-outcrop.py')
pipeline = module('pipeline', ROOT / 'scripts/prepare-cave.py')


def shell_margin(points, volume, mouths, overlap=1.2):
    height = points[:, 1] - mouths[1]['floorCenter'][1]
    upper = np.clip((height - 3) / 1, 0, 1)
    return outcrop.radial_margin(points, volume, mouths) + upper * overlap


def refine(mesh, colors, volume, mouths, edge_length=.1):
    for _ in range(12):
        triangles = mesh.triangles
        lengths = np.linalg.norm(triangles - np.roll(triangles, -1, axis=1), axis=2)
        margin = np.abs(shell_margin(mesh.vertices, volume, mouths))
        near = margin[mesh.faces].min(axis=1) < lengths.max(axis=1) + .15
        chosen = near & (lengths.max(axis=1) > edge_length)
        edges = np.sort(np.stack([mesh.faces, np.roll(mesh.faces, -1, axis=1)], axis=2)[chosen], axis=2)
        if not len(edges):
            return mesh, colors
        edges = np.unique(edges.reshape(-1, 2), axis=0)
        edges = edges[np.linalg.norm(mesh.vertices[edges[:, 0]] - mesh.vertices[edges[:, 1]], axis=1) > edge_length]
        if not len(edges):
            return mesh, colors
        midpoints = {tuple(edge): len(mesh.vertices) + i for i, edge in enumerate(edges)}
        vertices = np.vstack([mesh.vertices, mesh.vertices[edges].mean(axis=1)])
        colors = np.vstack([colors, colors[edges].mean(axis=1)])
        faces = []
        for face in mesh.faces:
            mids = [midpoints.get(tuple(sorted((face[j], face[(j + 1) % 3])))) for j in range(3)]
            split = [j for j, value in enumerate(mids) if value is not None]
            if not split:
                faces.append(face)
            elif len(split) == 3:
                a, b, c = face
                ab, bc, ca = mids
                faces.extend([[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]])
            elif len(split) == 1:
                i = split[0]
                a, b, c = np.roll(face, -i)
                faces.extend([[a, mids[i], c], [mids[i], b, c]])
            else:
                i = next(j for j in range(3) if j not in split)
                a, b, c = np.roll(face, -i)
                bc, ca = mids[(i + 1) % 3], mids[(i + 2) % 3]
                faces.extend([[c, ca, bc], [ca, a, b], [ca, b, bc]])
        mesh = trimesh.Trimesh(vertices, faces, process=False)
    raise ValueError('Scanned shell aperture refinement did not converge')


def prepare(height=13, burial=.7):
    if not np.isfinite([height, burial]).all() or height <= 0 or burial < .5:
        raise ValueError('Shell height must be positive and burial at least half a metre')
    data = json.loads((ROOT / 'src/cave/cave-data.json').read_text())
    path = ROOT / 'public/cave/mouth-fit.json'
    fit = json.loads(path.read_text())
    volume, mouths = fit['volume'], data['mouths']
    center, outward = np.array(mouths[1]['floorCenter']), np.array(mouths[1]['outward'])
    side = np.array([outward[2], 0, -outward[0]])
    mesh, colors = outcrop.source_scan('coastal_cliff_04')
    groups = trimesh.graph.connected_components(mesh.face_adjacency, nodes=np.arange(len(mesh.faces)), min_len=1)
    main = max(groups, key=lambda ids: mesh.area_faces[ids].sum())
    used, faces = np.unique(mesh.faces[main], return_inverse=True)
    mesh = trimesh.Trimesh(mesh.vertices[used], faces.reshape(-1, 3), process=False)
    colors = colors[used] / 255
    source_faces = len(mesh.faces)
    boundary = outcrop.boundary_vertices(mesh)
    rng = np.random.default_rng(4)
    directions = np.r_[np.eye(3), -np.eye(3), rng.normal(size=(384, 3))]
    directions /= np.linalg.norm(directions, axis=1)[:, None]
    support = (mesh.vertices @ directions.T).max(axis=0) - (mesh.vertices[boundary] @ directions.T).max(axis=0)
    up = directions[support.argmax()]
    horizontal = np.array([1., 0, 0]) - up * up[0]
    horizontal /= np.linalg.norm(horizontal)
    vertices = mesh.vertices @ np.column_stack([horizontal, up, np.cross(horizontal, up)])
    peak = vertices[vertices[:, 1].argmax()]
    vertices[:, [0, 2]] -= peak[[0, 2]]
    vertices[:, 1] -= vertices[boundary, 1].max()
    scale = height / support.max()
    vertices = vertices * scale - [0, burial, 0]
    mesh.vertices = center + vertices @ np.column_stack([side, [0, 1, 0], outward]).T
    angles = np.arange(64) * np.pi / 32
    radii = np.array(volume['radius'][-1]) + .15
    ring = center + np.array(volume['side'][-1]) * (radii * np.cos(angles))[:, None]
    ring[:, 1] += volume['axisHeight'] + radii * np.sin(angles)
    ring = ring[ring[:, 1] > center[1] + 3]
    depths = outcrop.front_depth(mesh, ring, outward, center)
    if not np.isfinite(depths).all():
        raise ValueError('Real scanned overburden does not cover the upper mouth profile')
    shift = .3 - depths.min()
    mesh.vertices += outward * shift
    mesh.update_faces(mesh.triangles[:, :, 1].max(axis=1) > center[1] - 1.5)
    mesh, colors = refine(mesh, colors, volume, mouths)
    mesh.update_faces(shell_margin(mesh.triangles_center, volume, mouths) >= 0)
    used, faces = np.unique(mesh.faces, return_inverse=True)
    result = trimesh.Trimesh(mesh.vertices[used], faces.reshape(-1, 3), process=False)
    colors = colors[used]
    groups = trimesh.graph.connected_components(result.face_adjacency, nodes=np.arange(len(result.faces)), min_len=1)
    keep = np.zeros(len(result.faces), dtype=bool)
    for ids in groups:
        if result.area_faces[ids].sum() >= .5:
            keep[ids] = True
    result.update_faces(keep)
    used, faces = np.unique(result.faces, return_inverse=True)
    result = trimesh.Trimesh(result.vertices[used], faces.reshape(-1, 3), process=False)
    colors = colors[used]
    normals = result.vertex_normals.copy()
    normals[np.linalg.norm(normals, axis=1) < .5] = [0, 1, 0]
    result.vertex_normals = normals
    output = ROOT / 'public/cave/mouth-mountain.glb'
    pipeline.export_glb(output, result, colors, np.array(data['route']), copyright='Coastal Cliff 04, Poly Haven, CC0')
    source = Path.home() / 'scans/cave-sources/coastal_cliff_04/coastal_cliff_04.bin'
    report = {'source': 'https://polyhaven.com/a/coastal_cliff_04', 'license': 'CC0',
              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'sourceTriangles': source_faces, 'uniformScale': float(scale),
              'burialMetres': burial, 'upperShellOverlapMetres': 1.2, 'protectedHeadroomMetres': 3,
              'outwardShiftMetres': float(shift), 'profileFrontDepthRange': [float(depths.min() + shift), float(depths.max() + shift)],
              'createdCapFaces': 0, 'snappedVertices': 0, 'webTriangles': len(result.faces),
              'webBytes': output.stat().st_size, 'bounds': result.bounds.tolist()}
    fit['mouths'][1]['scannedShell'] = report
    fit['mouths'][1]['rockTriangles'] = len(result.faces)
    path.write_text(json.dumps(fit, separators=(',', ':')))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--height', type=float, default=13)
    parser.add_argument('--burial', type=float, default=.7)
    args = parser.parse_args()
    prepare(args.height, args.burial)
