"""Fit scan triangles by deletion and bounded boundary snapping, without caps."""
import argparse
import importlib.util
import gc
import json
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pymeshlab
import requests
import trimesh
import shapely
from scipy.spatial import cKDTree

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/cave'
CACHE = Path.home() / 'scans/cave-sources'


def read_cave():
    scene = trimesh.load(PUBLIC / 'cave.glb', force='scene', process=False)
    mesh = next(iter(scene.geometry.values())).copy()
    blob = (PUBLIC / 'cave.glb').read_bytes()
    length = struct.unpack_from('<I', blob, 12)[0]
    gltf = json.loads(blob[20:20 + length])
    accessor = gltf['accessors'][gltf['meshes'][0]['primitives'][0]['attributes']['COLOR_0']]
    view = gltf['bufferViews'][accessor['bufferView']]
    color = np.ndarray((accessor['count'], 3), dtype=np.uint8, buffer=blob,
                       offset=28 + length + view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                       strides=(view.get('byteStride', 3), 1)).copy()
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=color)
    positions = subprocess.check_output(['node', str(ROOT / 'src/cave/prepare-mouth-data.mjs')])
    mesh.vertices = np.frombuffer(positions, dtype=np.float32).reshape(-1, 3).copy()
    return mesh


def profiles(cave, route):
    tangent = np.gradient(route, axis=0)
    side = np.column_stack([tangent[:, 2], np.zeros(len(route)), -tangent[:, 0]])
    side /= np.linalg.norm(side, axis=1)[:, None]
    angles = np.arange(64) * (2 * np.pi / 64)
    directions = side[:, None, :] * np.cos(angles)[None, :, None]
    directions[:, :, 1] = np.sin(angles)
    origins = np.repeat(route + [0, 1.1, 0], len(angles), axis=0)
    points, rays, _ = cave.ray.intersects_location(origins, directions.reshape(-1, 3), multiple_hits=True)
    radius = np.full(len(origins), np.inf)
    distance = np.linalg.norm(points - origins[rays], axis=1)
    valid = distance > .01
    np.minimum.at(radius, rays[valid], distance[valid])
    radius = radius.reshape(len(route), -1)
    radius[0], radius[-1] = radius[1].copy(), radius[-2].copy()
    for row in radius:
        good = np.flatnonzero(np.isfinite(row))
        if len(good) < 32:
            raise ValueError('Insufficient scanned wall coverage for a route profile')
        row[:] = np.interp(np.arange(64), np.r_[good - 64, good, good + 64], np.tile(row[good], 3))
    return {'route': route.tolist(), 'side': side.tolist(), 'axisHeight': 1.1, 'radius': radius.tolist(), 'clearance': .15}


def radial_margin(points, volume, mouths):
    route, sides, radii = [np.asarray(volume[k]) for k in ['route', 'side', 'radius']]
    ids = cKDTree(route[:, [0, 2]]).query(points[:, [0, 2]])[1]
    delta = points - route[ids]
    lateral = np.sum(delta * sides[ids], axis=1)
    height = delta[:, 1] - volume['axisHeight']
    angle = (np.arctan2(height, lateral) % (2 * np.pi)) * radii.shape[1] / (2 * np.pi)
    a = np.floor(angle).astype(int) % radii.shape[1]
    radius = radii[ids, a] * (1 - angle % 1) + radii[ids, (a + 1) % radii.shape[1]] * (angle % 1)
    inside = np.hypot(lateral, height) - radius
    for end, mouth in enumerate(mouths):
        beyond = (points - mouth['floorCenter']) @ np.array(mouth['outward']) > 0
        i = 0 if end == 0 else len(route) - 1
        local = points - route[i]
        x, y = local @ sides[i], local[:, 1] - volume['axisHeight']
        angle = (np.arctan2(y, x) % (2 * np.pi)) * radii.shape[1] / (2 * np.pi)
        a = np.floor(angle).astype(int) % radii.shape[1]
        r = radii[i, a] * (1 - angle % 1) + radii[i, (a + 1) % radii.shape[1]] * (angle % 1)
        inside[beyond] = (np.hypot(x, y) - r)[beyond]
    return inside


def contains(points, volume, mouths):
    return radial_margin(points, volume, mouths) < volume['clearance']


def aperture_faces(mesh, volume, mouths, ends):
    route = np.array(volume['route'])
    nearest = cKDTree(route[:, [0, 2]]).query(mesh.triangles_center[:, [0, 2]])[1]
    selected = np.zeros(len(mesh.faces), dtype=bool)
    for end in ends:
        d = (mesh.triangles_center - mouths[end]['floorCenter']) @ np.array(mouths[end]['outward'])
        selected |= (d > -30) & ((nearest < 15) if end == 0 else (nearest >= len(route) - 15))
    return selected


def refine_aperture(mesh, colors, volume, mouths, ends, surface=None):
    for _ in range(12):
        triangles = mesh.vertices[mesh.faces]
        lengths = np.linalg.norm(triangles - np.roll(triangles, -1, axis=1), axis=2)
        distance = np.abs(radial_margin(mesh.vertices, volume, mouths)) if surface is None else surface.query(mesh.vertices)[0]
        near = distance[mesh.faces].min(axis=1) < (1.2 if surface is None else .16) + lengths.max(axis=1)
        chosen = near & aperture_faces(mesh, volume, mouths, ends)
        edges = np.sort(np.stack([mesh.faces, np.roll(mesh.faces, -1, axis=1)], axis=2)[chosen & (lengths.max(axis=1) > .04)], axis=2)
        if not len(edges):
            break
        edges = np.unique(edges.reshape(-1, 2), axis=0)
        edges = edges[np.linalg.norm(mesh.vertices[edges[:, 0]] - mesh.vertices[edges[:, 1]], axis=1) > .04]
        if not len(edges):
            break
        count = len(mesh.vertices)
        midpoints = {tuple(edge): count + i for i, edge in enumerate(edges)}
        vertices = np.vstack([mesh.vertices, mesh.vertices[edges].mean(axis=1)])
        colors = np.vstack([colors, colors[edges].mean(axis=1)])
        faces = []
        for face in mesh.faces:
            mids = [midpoints.get(tuple(sorted((face[j], face[(j + 1) % 3])))) for j in range(3)]
            split = [j for j, value in enumerate(mids) if value is not None]
            if not split:
                faces.append(face)
            elif len(split) == 3:
                a, b, c = face; ab, bc, ca = mids
                faces.extend([[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]])
            elif len(split) == 1:
                i = split[0]; a, b, c = np.roll(face, -i); m = mids[i]
                faces.extend([[a, m, c], [m, b, c]])
            else:
                i = next(j for j in range(3) if j not in split)
                a, b, c = np.roll(face, -i); bc, ca = mids[(i + 1) % 3], mids[(i + 2) % 3]
                faces.extend([[c, ca, bc], [ca, a, b], [ca, b, bc]])
        mesh = trimesh.Trimesh(vertices, faces, process=False)
    else:
        raise ValueError('Aperture refinement did not converge')
    return mesh, colors


def terrain_contact(cave, route, mouths):
    host = json.loads(subprocess.check_output(['node', str(ROOT / 'src/cave/prepare-mouth-data.mjs'), '--terrain']))
    center, outward = np.array(mouths[0]['floorCenter']), np.array(mouths[0]['outward'])
    side = np.array([outward[2], 0, -outward[0]])
    d = (cave.triangles_center - center) @ outward
    ids = cKDTree(route[:, [0, 2]]).query(cave.triangles_center[:, [0, 2]])[1]
    floor = (d > -12) & (d < .2) & (cave.face_normals[:, 1] > .45) & (np.abs(cave.triangles_center[:, 1] - route[ids, 1]) < .8)
    footprint = shapely.union_all([shapely.Polygon(tri[:, [0, 2]]) for tri in cave.triangles[floor]]).buffer(-.025)
    corners = np.array([center + side * x + outward * z for x, z in [(-1000, -1000), (1000, -1000), (1000, -4), (-1000, -4)]])
    deep = shapely.LineString(route[:, [0, 2]]).buffer(9).intersection(shapely.Polygon(corners[:, [0, 2]]))
    opening = shapely.union_all([footprint, deep])
    records = []
    for index, vertices in host['triangles']:
        vertices = np.array(vertices)
        xy = vertices[:, [0, 2]]
        polygon = shapely.Polygon(xy).difference(opening)
        triangles = shapely.constrained_delaunay_triangles(polygon)
        inverse = np.linalg.inv(np.vstack([xy.T, np.ones(3)]))
        weights = []
        sign = np.linalg.det(np.column_stack([xy[1] - xy[0], xy[2] - xy[0]]))
        for triangle in triangles.geoms:
            points = np.array(triangle.exterior.coords)[:3]
            if triangle.area < 1e-10:
                continue
            if np.linalg.det(np.column_stack([points[1] - points[0], points[2] - points[0]])) * sign < 0:
                points = points[[0, 2, 1]]
            weights.extend((inverse @ np.vstack([points.T, np.ones(3)])).T.round(10).tolist())
        records.append([index, weights])
    path = ROOT / 'src/cave/cave-terrain-cuts.json'
    path.write_text(json.dumps({'vertexCount': host['vertexCount'], 'indexCount': host['indexCount'], 'triangles': records}, separators=(',', ':')))


def source_scan(asset):
    directory = CACHE / asset
    directory.mkdir(exist_ok=True)
    path = directory / 'cliff.gltf'
    if not path.exists():
        response = requests.get(f'https://api.polyhaven.com/files/{asset}', timeout=60)
        response.raise_for_status()
        entry = response.json()['gltf']['1k']['gltf']
        for name, info in list(entry['include'].items()) + [('cliff.gltf', entry)]:
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            response = requests.get(info['url'], timeout=120)
            response.raise_for_status()
            target.write_bytes(response.content)
    source = trimesh.load(path, force='mesh', process=False)
    color = source.visual.to_color().vertex_colors[:, :3].copy()
    color_positions = source.vertices.copy()
    source.merge_vertices(merge_tex=True, merge_norm=True, digits_vertex=5)
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(vertex_matrix=source.vertices, face_matrix=source.faces))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=90000, preservenormal=True, preservetopology=True, preserveboundary=True)
    reduced = ms.current_mesh()
    mesh = trimesh.Trimesh(reduced.vertex_matrix(), reduced.face_matrix(), process=False)
    mesh.merge_vertices(merge_tex=True, merge_norm=True, digits_vertex=5)
    colors = color[cKDTree(color_positions).query(mesh.vertices)[1]]
    return mesh, colors


def boundary_vertices(mesh):
    edges = mesh.edges_unique[np.bincount(mesh.edges_unique_inverse) == 1]
    return np.unique(edges)


def front_depth(mesh, points, outward, center):
    depth = np.full(len(points), -np.inf)
    for start in range(0, len(points), 256):
        batch = points[start:start + 256]
        locations, rays, _ = mesh.ray.intersects_location(batch + outward * 400, np.tile(-outward, (len(batch), 1)), multiple_hits=False)
        if len(rays):
            depth[start + rays] = (locations - center) @ outward
    return depth


def place_scan(scan, end, mouth, volume):
    outward, center = np.array(mouth['outward']), np.array(mouth['floorCenter'])
    side = np.array([outward[2], 0, -outward[0]])
    boundary = boundary_vertices(scan)
    rng = np.random.default_rng(4)
    normals = np.vstack([np.eye(3), -np.eye(3), rng.normal(size=(384, 3))])
    normals /= np.linalg.norm(normals, axis=1)[:, None]
    support = np.concatenate([(scan.vertices @ normals[i:i + 32].T).max(axis=0) - (scan.vertices[boundary] @ normals[i:i + 32].T).max(axis=0)
                              for i in range(0, len(normals), 32)])
    up = normals[support.argmax()]
    horizontal = np.array([1., 0, 0]) - up * up[0]
    horizontal /= np.linalg.norm(horizontal)
    vertices = scan.vertices @ np.column_stack([horizontal, up, np.cross(horizontal, up)])
    peak = vertices[vertices[:, 1].argmax()]
    height = max(7.5, max(volume['radius'][0 if end == 0 else -1]) + volume['axisHeight'] + 2.5)
    scale = (height + 3) / support.max()
    vertices[:, [0, 2]] -= peak[[0, 2]]
    vertices[:, 1] -= vertices[boundary, 1].max()
    scan.vertices = vertices * scale - [0, 3, 0]
    scan.vertices = center + scan.vertices @ np.column_stack([side, [0, 1, 0], outward]).T
    i = 0 if end == 0 else -1
    angle = np.arange(64) * (2 * np.pi / 64)
    radius = np.array(volume['radius'][i]) + .15
    ring = center + np.array(volume['side'][i]) * (radius * np.cos(angle))[:, None]
    ring[:, 1] += volume['axisHeight'] + radius * np.sin(angle)
    depths = front_depth(scan, ring, outward, center)
    if not np.isfinite(depths).all():
        raise ValueError(f'Outcrop {end} does not cover the mouth profile')
    shift = -depths.max() - .02
    print('Mouth placement', end, 'profile depth range', float(np.ptp(depths)), 'shift', float(shift), flush=True)
    scan.vertices = scan.vertices + outward * shift
    relative = scan.vertices - center
    scan.vertices = center + (relative @ side)[:, None] * side * (1.4 if end else 1) + (relative @ outward)[:, None] * outward * .5
    scan.vertices[:, 1] = center[1] + relative[:, 1] * (1.8 if end else 1.4)
    return scan, shift


def export(path, mesh, colors, route, pipeline, volume, mouths, end):
    colors = np.round(np.clip(colors, 0, 255)).astype(np.uint8)
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=colors)
    parameters = pipeline.route_parameters(mesh.vertices, route)
    weight = np.clip((2.4 - np.abs(radial_margin(mesh.vertices, volume, mouths))) / 2, 0, 1)
    weight = weight * weight * (3 - 2 * weight)
    mesh.vertex_attributes['_CAVE_ROUTE'] = (end + (parameters - end) * weight).astype(np.float32)
    path.write_bytes(mesh.export(file_type='glb', include_normals=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--end', choices=['forest', 'both'], default='both')
    args = parser.parse_args()
    data = json.loads((ROOT / 'src/cave/cave-data.json').read_text())
    route = np.array(data['route'])
    cave = read_cave()
    colors = cave.visual.vertex_colors.copy()
    volume = profiles(cave, route)
    ends = [0] if args.end == 'forest' else [0, 1]
    terrain_contact(cave, route, data['mouths'])
    scans, reports = [], []
    for end, asset in enumerate(['coastal_cliff_04', 'coastal_cliff_04'][:1 if args.end == 'forest' else 2]):
        scan, tint = source_scan(asset)
        scan, shift = place_scan(scan, end, data['mouths'][end], volume)
        scan, tint = refine_aperture(scan, tint, volume, data['mouths'], [end])
        gc.collect()
        print('Refined', asset, len(scan.faces), flush=True)
        outward, center = np.array(data['mouths'][end]['outward']), np.array(data['mouths'][end]['floorCenter'])
        source_faces = len(scan.faces)
        margin = np.abs(radial_margin(scan.vertices, volume, data['mouths']))
        near = (margin[scan.faces].min(axis=1) < 1.2) & aperture_faces(scan, volume, data['mouths'], [end])
        maximum_edge = np.linalg.norm(scan.triangles[near] - np.roll(scan.triangles[near], -1, axis=1), axis=2).max()
        scans.append((scan, tint))
        reports.append({'mouth': ['forest', 'mountain'][end], 'source': asset, 'sourceTriangles': source_faces, 'createdFaces': 0, 'outwardShift': float(shift), 'maxApertureEdgeBeforeCut': float(maximum_edge)})
    surface = cKDTree(np.vstack([scan.vertices for scan, _ in scans]))
    cave, colors = refine_aperture(cave, colors, volume, data['mouths'], ends, surface)
    gc.collect()
    print('Refined tube', len(cave.faces), flush=True)
    retain = np.ones(len(cave.faces), dtype=bool)
    for end, (scan, _) in enumerate(scans):
        outward, center = np.array(data['mouths'][end]['outward']), np.array(data['mouths'][end]['floorCenter'])
        d = (cave.triangles_center - center) @ outward
        nearest = cKDTree(route[:, [0, 2]]).query(cave.triangles_center[:, [0, 2]])[1]
        floor = (cave.face_normals[:, 1] > .45) & (np.abs(cave.triangles_center[:, 1] - route[nearest, 1]) < .8)
        candidates = np.flatnonzero(aperture_faces(cave, volume, data['mouths'], [end]) & ~floor)
        depths = front_depth(scan, cave.triangles_center[candidates], outward, center)
        retain[candidates[np.isfinite(depths) & (d[candidates] > depths + .005)]] = False
        interior = contains(scan.vertices, volume, data['mouths'])
        scan.update_faces(~contains(scan.triangles_center, volume, data['mouths']) & ~interior[scan.faces].any(axis=1))
    tube = trimesh.Trimesh(cave.vertices.copy(), cave.faces[retain], process=False)
    labels = trimesh.graph.connected_component_labels(tube.face_adjacency, node_count=len(tube.faces))
    tube.update_faces(labels == np.bincount(labels).argmax())
    lo, hi = tube.bounds
    quantized = np.round((tube.vertices - lo) / (hi - lo) * 65535) / 65535 * (hi - lo) + lo
    rim = tube.vertices[boundary_vertices(tube)]
    tree = cKDTree(rim)
    actual_volume = {**volume, 'clearance': 0}
    for end, ((scan, tint), report) in enumerate(zip(scans, reports)):
        original = scan.vertices.copy()
        moved = np.zeros(len(scan.vertices), dtype=bool)
        removed_needles = removed_folded = 0
        for _ in range(16):
            count = len(scan.faces)
            boundary = boundary_vertices(scan)
            original_normals = scan.face_normals.copy()
            distance, ids = tree.query(original[boundary])
            snap = distance <= .4
            scan.vertices[boundary[snap]] = rim[ids[snap]]
            moved[boundary[snap]] = True
            scan.vertices = np.asarray(scan.vertices, dtype=np.float32).astype(np.float64)
            folded = moved[scan.faces].any(axis=1) & ((scan.face_normals * original_normals).sum(axis=1) <= 0)
            removed_folded += int(folded.sum())
            scan.update_faces(~folded)
            scan.update_faces(scan.nondegenerate_faces(height=1e-7))
            scan.update_faces(~contains(scan.triangles_center, actual_volume, data['mouths']))
            lengths = np.linalg.norm(scan.triangles - np.roll(scan.triangles, -1, axis=1), axis=2).max(axis=1)
            needles = moved[scan.faces].any(axis=1) & (lengths > .08) & (2 * scan.area_faces / lengths < .012)
            removed_needles += int(needles.sum())
            scan.update_faces(~needles)
            if len(scan.faces) == count:
                break
        edges = np.linalg.norm(scan.triangles - np.roll(scan.triangles, -1, axis=1), axis=2)
        lengths = edges.max(axis=1)
        aspect = lengths * lengths / np.maximum(2 * scan.area_faces, 1e-15)
        cosine = (edges * edges + np.roll(edges, -1, axis=1) ** 2 - np.roll(edges, -2, axis=1) ** 2) / np.maximum(2 * edges * np.roll(edges, -1, axis=1), 1e-15)
        minimum_angle = np.arccos(np.clip(cosine, -1, 1)).min(axis=1)
        slivers = (end == 0) & moved[scan.faces].any(axis=1) & ((aspect > 8) | (minimum_angle < np.deg2rad(6)))
        report['removedRimSlivers'] = int(slivers.sum())
        scan.update_faces(~slivers)
        boundary = boundary_vertices(scan) if end == 0 else np.array([], dtype=int)
        final_rim = quantized[boundary_vertices(tube)]
        distance, ids = cKDTree(final_rim).query(original[boundary])
        snap = distance <= .4
        scan.vertices[boundary[snap]] = final_rim[ids[snap]]
        moved[boundary[snap]] = True
        scan.update_faces(scan.nondegenerate_faces(height=1e-7))
        scan.update_faces(~contains(scan.triangles_center, actual_volume, data['mouths']))
        displacement = np.linalg.norm(scan.vertices - original, axis=1)
        report.update(rockTriangles=len(scan.faces), snappedVertices=int(moved.sum()), maxSnapMetres=float(displacement.max()),
                      removedNeedles=removed_needles, removedFolded=removed_folded, insideCentroids=int(contains(scan.triangles_center, actual_volume, data['mouths']).sum()), baseDepthMetres=float(data['mouths'][end]['floorCenter'][1] - scan.bounds[0, 1]))
        unique, inverse = trimesh.grouping.unique_rows(scan.vertices) if end == 0 else (np.arange(len(scan.vertices)), np.arange(len(scan.vertices)))
        scan = trimesh.Trimesh(scan.vertices[unique], inverse[scan.faces], process=False)
        scan.update_faces(scan.nondegenerate_faces(height=1e-7))
        scan.update_faces(scan.unique_faces())
        scans[end] = (scan, tint[unique])
        report['rockTriangles'] = len(scan.faces)
        i = 0 if end == 0 else -1
        angle = np.arange(64) * (2 * np.pi / 64)
        side = np.array([data['mouths'][end]['outward'][2], 0, -data['mouths'][end]['outward'][0]])
        sign = np.dot(side, volume['side'][i])
        report['apertureGuards'] = [[float(sign * (r + margin) * np.cos(a)), float(volume['axisHeight'] + (r + margin) * np.sin(a))]
                                    for margin in [.06, .25, .8] for r, a in zip(volume['radius'][i], angle)]
    spec = importlib.util.spec_from_file_location('prepare_cave', ROOT / 'scripts/prepare-cave.py')
    pipeline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pipeline)
    pipeline.export_glb(PUBLIC / 'cave-fitted.glb', tube, colors[:, :3] / 255, route)
    for end, ((scan, tint), report) in enumerate(zip(scans, reports)):
        export(PUBLIC / f"mouth-{report['mouth']}.glb", scan, tint, route, pipeline, volume, data['mouths'], end)
    result = {'version': 5, 'volume': volume, 'mouths': reports, 'tubeTriangles': len(tube.faces), 'createdFaces': 0}
    (PUBLIC / 'mouth-fit.json').write_text(json.dumps(result, separators=(',', ':')))
    print(json.dumps({k: v for k, v in result.items() if k != 'volume'}), flush=True)


if __name__ == '__main__':
    main()
