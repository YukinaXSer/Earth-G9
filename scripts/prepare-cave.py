"""Build the cave from the original CC-BY Bageshawe GLB and Poly Haven API.

python3 -m pip install numpy scipy pillow trimesh rtree shapely pymeshlab requests
python3 scripts/prepare-cave.py --source ~/scans/1183fc2d392e4eee9ebe74d07af0361c.glb \
  --analysis ~/scans/1183fc2d392e4eee9ebe74d07af0361c-analysis.json
Subsequent builds can omit --analysis: the source-coordinate seed is in cave-data.json.
Downloaded originals are cached outside public/, under ~/scans/cave-sources/.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pymeshlab
import numpy as np
import requests
import trimesh
from PIL import Image
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public' / 'cave'
DATA = ROOT / 'src' / 'cave' / 'cave-data.json'
UID = '1183fc2d392e4eee9ebe74d07af0361c'
SETS = ['rock_face_03', 'rock_surface', 'rock_face_04', 'rock_ground_02']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def linear(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def source_mesh(path):
    scene = trimesh.load(path, force='scene', process=False)
    parts, colors = [], []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        part = scene.geometry[name].copy()
        image = part.visual.material.baseColorTexture.convert('RGB')
        uv = part.visual.uv % 1
        x = np.minimum((uv[:, 0] * image.width).astype(int), image.width - 1)
        y = np.minimum(((1 - uv[:, 1]) * image.height).astype(int), image.height - 1)
        colors.append(linear(np.asarray(image)[y, x] / 255.))
        part.visual = trimesh.visual.ColorVisuals(part)
        part.apply_transform(transform)
        parts.append(part)
    mesh = trimesh.util.concatenate(parts)
    tint_positions = mesh.vertices.copy()
    center = mesh.bounds.mean(axis=0)
    mesh.vertices -= center
    mesh.merge_vertices(digits_vertex=5)
    return mesh, tint_positions - center, np.concatenate(colors), center


def distances(points):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]


def resample(points, step=.5):
    d = distances(points)
    samples = np.r_[np.arange(0, d[-1], step), d[-1]]
    return np.stack([np.interp(samples, d, points[:, k]) for k in range(3)], axis=1)


def floors(mesh, positions, expected):
    origins = positions.copy()
    origins[:, 1] = mesh.bounds[1, 1] + 1
    loc, ray, _ = mesh.ray.intersects_location(origins, np.tile([0, -1, 0], (len(origins), 1)), multiple_hits=True)
    hits = [[] for _ in positions]
    for p, i in zip(loc, ray):
        hits[i].append(p[1])
    result = positions.copy()
    heights = np.zeros(len(positions))
    for i, values in enumerate(hits):
        ys = np.unique(np.round(values, 5))
        possible = [(abs(y - expected[i]), y, ys[k + 1] - y) for k, y in enumerate(ys[:-1])
                    if ys[k + 1] - y >= 2.2 and abs(y - expected[i]) < 1.5]
        if possible:
            _, result[i, 1], heights[i] = min(possible)
    return result, heights


def widths(mesh, route):
    tangent = np.gradient(route, axis=0)
    side = np.c_[tangent[:, 2], np.zeros(len(route)), -tangent[:, 0]]
    side /= np.linalg.norm(side, axis=1)[:, None]
    widths = []
    margins = []
    for eye in [.3, 1.1, 2.2]:
        origin = route + [0, eye, 0]
        origin = np.r_[origin, origin]
        directions = np.r_[side, -side]
        loc, ray, _ = mesh.ray.intersects_location(origin, directions, multiple_hits=True)
        near = np.full(len(origin), np.inf)
        ds = np.linalg.norm(loc - origin[ray], axis=1)
        good = ds > .02
        np.minimum.at(near, ray[good], ds[good])
        widths.append(near[:len(route)] + near[len(route):])
        margins.append(np.minimum(near[:len(route)], near[len(route):]))
    return np.min(widths, axis=0), np.min(margins, axis=0), side


def prepare_route(mesh, seed):
    route = resample(seed)
    route[:, [0, 2]] = gaussian_filter1d(route[:, [0, 2]], 1.5, axis=0, mode='nearest')
    route, height = floors(mesh, route, route[:, 1])
    # Detour around low boulders without changing any scanned surface.
    for _ in range(2):
        width, margin, side = widths(mesh, route)
        bad = np.flatnonzero((width < 1.65) | (margin < .65))
        for i in bad:
            offsets = np.arange(-1.5, 1.51, .25)
            candidates = route[i] + offsets[:, None] * side[i]
            candidates, h = floors(mesh, candidates, np.full(len(candidates), route[i, 1]))
            triples = np.stack([candidates - np.gradient(route, axis=0)[i], candidates,
                                candidates + np.gradient(route, axis=0)[i]], axis=1).reshape(-1, 3)
            w, m, _ = widths(mesh, triples)
            score = m[1::3] - abs(offsets) * .12
            score[(h < 2.2) | (w[1::3] < 1.65)] = -np.inf
            if np.isfinite(score).any():
                offset = offsets[np.argmax(score)]
                weights = np.exp(-((np.arange(len(route)) - i) / 2) ** 2)
                route += weights[:, None] * offset * side[i]
        route, height = floors(mesh, route, route[:, 1])
    route = resample(route)
    route, height = floors(mesh, route, route[:, 1])
    width, _, _ = widths(mesh, route)
    original_distance = cKDTree(seed).query(route)[1]
    seed_d = distances(seed)
    selected = (seed_d[original_distance] >= 6) & (seed_d[original_distance] <= 48)
    a, b = np.flatnonzero(selected)[[0, -1]]
    valid = (height >= 2.2) & (width >= 1.6) & np.isfinite(width)
    if not valid[a:b + 1].all():
        raise ValueError('Selected body no longer meets clearance after centreline fitting')
    while a > 0 and valid[a - 1]:
        a -= 1
    while b < len(route) - 1 and valid[b + 1]:
        b += 1
    return route[a:b + 1], height[a:b + 1], width[a:b + 1]


def cut(mesh, point, inward):
    return trimesh.intersections.slice_mesh_plane(mesh, inward, point, cap=False)


def close_microholes(mesh):
    directed = mesh.edges
    _, inverse, counts = np.unique(np.sort(directed, axis=1), axis=0, return_inverse=True, return_counts=True)
    boundary = directed[counts[inverse] == 1]
    neighbors = {}
    for a, b in boundary:
        neighbors.setdefault(int(a), set()).add(int(b))
        neighbors.setdefault(int(b), set()).add(int(a))
    unseen = set(neighbors)
    vertices, faces = mesh.vertices.tolist(), mesh.faces.tolist()
    while unseen:
        stack, group = [unseen.pop()], set()
        while stack:
            i = stack.pop()
            group.add(i)
            for j in neighbors[i] & unseen:
                unseen.remove(j)
                stack.append(j)
        points = mesh.vertices[list(group)]
        if len(group) > 20 or np.linalg.norm(np.ptp(points, axis=0)) > .2:
            continue
        remaining = {tuple(sorted((int(a), int(b)))) for a, b in boundary if a in group and b in group}
        oriented = {(int(a), int(b)) for a, b in boundary if a in group and b in group}
        if any(len(neighbors[i]) % 2 for i in group):
            continue
        while remaining:
            path = [next(iter(remaining))[0]]
            while True:
                here = path[-1]
                candidates = [e for e in remaining if here in e]
                if not candidates:
                    break
                edge = candidates[0]
                remaining.remove(edge)
                other = edge[1] if edge[0] == here else edge[0]
                if other in path:
                    loop = path[path.index(other):]
                    if len(loop) >= 3:
                        center = len(vertices)
                        vertices.append(mesh.vertices[loop].mean(0).tolist())
                        for a, b in zip(loop, loop[1:] + loop[:1]):
                            faces.append([b, a, center] if (a, b) in oriented else [a, b, center])
                    path = path[:path.index(other) + 1]
                else:
                    path.append(other)
    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False)


def route_parameters(vertices, route):
    nearest = cKDTree(route[:, [0, 2]]).query(vertices[:, [0, 2]])[1]
    cumulative = distances(route)
    choices = []
    for offset in [-1, 0]:
        i = np.clip(nearest + offset, 0, len(route) - 2)
        a, b = route[i], route[i + 1]
        delta = b[:, [0, 2]] - a[:, [0, 2]]
        t = np.clip(np.sum((vertices[:, [0, 2]] - a[:, [0, 2]]) * delta, axis=1) /
                    np.maximum(np.sum(delta * delta, axis=1), 1e-9), 0, 1)
        error = np.sum((vertices[:, [0, 2]] - a[:, [0, 2]] - t[:, None] * delta) ** 2, axis=1)
        choices.append((error, (cumulative[i] + t * (cumulative[i + 1] - cumulative[i])) / cumulative[-1]))
    return np.where(choices[0][0] < choices[1][0], choices[0][1], choices[1][1])


def export_glb(path, mesh, colors, route, *, copyright='Bageshawe Resurgence Dry Passage, cave-dive-make, CC BY 4.0', shade=None):
    lo, hi = mesh.bounds
    extent = hi - lo
    normals = mesh.vertex_normals * extent
    normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-12)
    arrays = [np.pad(np.round((mesh.vertices - lo) / extent * 65535).astype('<u2'), ((0, 0), (0, 1))),
              np.pad(np.round(normals * 32767).astype('<i2'), ((0, 0), (0, 1))),
              np.pad(np.round(np.clip(colors, 0, 1) * 255).astype('u1'), ((0, 0), (0, 1))),
              mesh.faces.astype('<u4').reshape(-1),
              np.c_[np.round(route_parameters(mesh.vertices, route) * 65535).astype('<u2'), np.zeros(len(mesh.vertices), dtype='<u2')]]
    if shade is not None:
        arrays.append(np.c_[np.round(np.clip(shade, 0, 1) * 255).astype('u1'), np.zeros((len(shade), 3), dtype='u1')])
    blob = bytearray()
    views, accessors = [], []
    for i, array in enumerate(arrays):
        blob.extend(b'\0' * (-len(blob) % 4))
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': array.nbytes,
                      'target': 34963 if i == 3 else 34962})
        if i != 3:
            views[-1]['byteStride'] = array.strides[0]
        blob.extend(array.tobytes())
        accessor = {'bufferView': i, 'componentType': [5123, 5122, 5121, 5125, 5123, 5121][i],
                    'count': len(array), 'type': 'SCALAR' if i >= 3 else 'VEC3'}
        if i != 3:
            accessor['normalized'] = True
        if i == 0:
            accessor.update(min=[0, 0, 0], max=[65535, 65535, 65535])
        accessors.append(accessor)
    gltf = {'asset': {'version': '2.0', 'generator': 'Earth-G9 prepare-cave.py',
                      'copyright': copyright},
            'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
            'scene': 0, 'scenes': [{'nodes': [0]}],
            'nodes': [{'mesh': 0, 'translation': lo.tolist(), 'scale': extent.tolist()}],
            'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'COLOR_0': 2, '_CAVE_ROUTE': 4},
                                        'indices': 3, 'material': 0}]}],
            'materials': [{'name': 'Scanned macro tint', 'doubleSided': True,
                           'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1}}],
            'buffers': [{'byteLength': len(blob)}], 'bufferViews': views, 'accessors': accessors}
    if shade is not None:
        gltf['meshes'][0]['primitives'][0]['attributes']['_CAVE_SHADE'] = 5
    header = json.dumps(gltf, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    blob += b'\0' * (-len(blob) % 4)
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, 12 + 8 + len(header) + 8 + len(blob)) +
                     struct.pack('<II', len(header), 0x4e4f534a) + header +
                     struct.pack('<II', len(blob), 0x004e4942) + blob)


def textures(cache):
    manifest = []
    for asset in SETS:
        info = requests.get('https://api.polyhaven.com/files/' + asset, timeout=60)
        info.raise_for_status()
        files = info.json()
        entry = {'id': asset, 'url': 'https://polyhaven.com/a/' + asset, 'license': 'CC0', 'maps': {}}
        for key, channel, quality in [('color', 'Diffuse', 88), ('normal', 'nor_gl', 90), ('roughness', 'Rough', 82)]:
            if asset == 'rock_ground_02':
                quality = {'color': 78, 'normal': 78, 'roughness': 65}[key]
            source = files[channel]['2k']['jpg']
            original = cache / (asset + '-' + key + '.jpg')
            if not original.exists():
                response = requests.get(source['url'], timeout=180)
                response.raise_for_status()
                original.write_bytes(response.content)
            if hashlib.md5(original.read_bytes()).hexdigest() != source['md5']:
                raise ValueError('Poly Haven checksum mismatch: ' + str(original))
            image = Image.open(original).convert('RGB' if key != 'roughness' else 'L')
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            filename = asset + '-' + key + '.webp'
            image.save(PUBLIC / filename, quality=quality, method=6)
            entry['maps'][key] = {'file': filename, 'bytes': (PUBLIC / filename).stat().st_size,
                                  'width': image.width, 'height': image.height, 'source': source,
                                  'sha256': digest(PUBLIC / filename)}
        manifest.append(entry)
        print('PBR', asset, sum(m['bytes'] for m in entry['maps'].values()), flush=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--analysis', type=Path)
    parser.add_argument('--textures-only', action='store_true')
    parser.add_argument('--mesh-only', action='store_true')
    args = parser.parse_args()
    PUBLIC.mkdir(exist_ok=True, parents=True)
    DATA.parent.mkdir(exist_ok=True, parents=True)
    cache = Path.home() / 'scans' / 'cave-sources'
    cache.mkdir(exist_ok=True, parents=True)
    data = json.loads(DATA.read_text()) if DATA.exists() else {}
    if not args.textures_only:
        print('Loading atlas and source form', flush=True)
        mesh, color_positions, colors, center = source_mesh(args.source)
        if args.analysis:
            analysis = json.loads(args.analysis.read_text())
            seed = np.array(analysis['route'])[:, :3]
        else:
            seed = np.array(data['sourceRoute'])
        route, heights, measured_widths = prepare_route(mesh, seed)
        print('Route', distances(route)[-1], 'height', heights.min(), 'width', measured_widths.min(), flush=True)
        forward = route[-1] - route[0]
        yaw = np.arctan2(-forward[0], forward[2])
        c, s = np.cos(yaw), np.sin(yaw)
        rotation = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        origin = route[0].copy()
        mesh.vertices = (mesh.vertices - origin) @ rotation.T
        color_positions = (color_positions - origin) @ rotation.T
        route = (route - origin) @ rotation.T
        directions = []
        for i, k in [(0, 4), (-1, -5)]:
            direction = route[i] - route[k]
            direction[1] = 0
            directions.append(direction / np.linalg.norm(direction))
        for point, outward in zip(route[[0, -1]], directions):
            mesh = cut(mesh, point + outward * 2, -outward)
        print('Decimating', len(mesh.faces), flush=True)
        simplifier = pymeshlab.MeshSet()
        simplifier.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
        simplifier.meshing_repair_non_manifold_edges(method='Remove Faces')
        simplifier.meshing_decimation_quadric_edge_collapse(targetfacenum=160000,
            preserveboundary=True, boundaryweight=10, preservenormal=True,
            preservetopology=True, optimalplacement=True, autoclean=True)
        result = simplifier.current_mesh()
        mesh = trimesh.Trimesh(vertices=result.vertex_matrix(), faces=result.face_matrix(), process=False)
        for point, outward in zip(route[[0, -1]], directions):
            mesh = cut(mesh, point, -outward)
        mesh.merge_vertices(digits_vertex=5)
        mesh.update_faces(mesh.nondegenerate_faces(height=1e-7))
        mesh.update_faces(mesh.unique_faces())
        mesh.remove_unreferenced_vertices()
        mesh = close_microholes(mesh)
        # Spatial atlas averaging leaves photographic macro tint, not a second detail atlas.
        cells, inverse = np.unique(np.floor(color_positions / .35).astype(int), axis=0, return_inverse=True)
        counts = np.bincount(inverse)
        averages = np.stack([np.bincount(inverse, weights=colors[:, i]) / counts for i in range(3)], axis=1)
        ds, indices = cKDTree((cells + .5) * .35).query(mesh.vertices, k=8)
        weight = 1 / np.maximum(ds, .1) ** 2
        tint = (averages[indices] * weight[:, :, None]).sum(1) / weight.sum(1)[:, None]
        tint = np.clip(tint / np.mean(colors) * .7, .15, 1)
        matrix = np.eye(4)
        matrix[:3, :3] = rotation
        matrix[:3, 3] = -rotation @ (center + origin)
        # Re-ground the exported route against the final simplified surface.
        route, final_heights = floors(mesh, route, route[:, 1])
        interior = (distances(route) > 1) & (distances(route) < distances(route)[-1] - 1)
        if (final_heights[interior] < 2.2).any():
            raise ValueError('Decimation lost standing clearance at ' + str(np.flatnonzero((final_heights < 2.2) & interior)))
        length = float(distances(route)[-1])
        source_t = distances(route)
        target_t = np.r_[np.arange(0, length, .5), length]
        route = np.stack([np.interp(target_t, source_t, route[:, i]) for i in range(3)], axis=1)
        route, final_heights = floors(mesh, route, route[:, 1])
        final_widths, _, _ = widths(mesh, route)
        export_glb(PUBLIC / 'cave.glb', mesh, tint, route)
        # Mouth samples are open and intentionally excluded from interior ray qualification.
        inside = (target_t > 1) & (target_t < length - 1)
        edges, edge_counts = np.unique(np.sort(mesh.edges, axis=1), axis=0, return_counts=True)
        boundary = edges[edge_counts == 1]
        mouths = []
        for i, direction in zip([0, -1], directions):
            points = mesh.vertices[np.unique(boundary)]
            ring = points[abs((points - route[i]) @ direction) < .002]
            if len(ring) < 3:
                raise ValueError('Missing cut mouth boundary')
            bounds = np.array([ring.min(0), ring.max(0)])
            mouths.append({'floorCenter': route[i].tolist(), 'center': bounds.mean(0).tolist(),
                           'outward': direction.tolist(), 'bounds': bounds.tolist()})
        delta = np.diff(route, axis=0)
        slopes = np.degrees(np.arctan2(abs(delta[:, 1]), np.linalg.norm(delta[:, [0, 2]], axis=1)))
        bends = []
        for start, end in [(2, length * .45), (length * .55, length - 2)]:
            candidates = np.flatnonzero((target_t > start) & (target_t < end))
            turns = []
            for i in candidates:
                a, b = route[i] - route[max(0, i - 10)], route[min(len(route) - 1, i + 10)] - route[i]
                a[1] = b[1] = 0
                turns.append(np.arccos(np.clip(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)), -1, 1)))
            k = int(candidates[np.argmax(turns)])
            bends.append({'distance': float(target_t[k]), 'position': route[k].tolist(),
                          'turnDegrees': float(np.degrees(max(turns)))})
        data.update(version=1, units='metres', scaleBasis='1 source unit = 1 m, as directed for stage 1',
                    source={'uid': UID, 'author': 'cave-dive-make', 'license': 'CC BY 4.0',
                            'url': 'https://sketchfab.com/3d-models/' + UID, 'sha256': digest(args.source)},
                    sourceRoute=seed.tolist(), transform={'matrix': matrix.T.flatten().tolist(),
                    'sourceCenter': center.tolist(), 'translationOrigin': origin.tolist(), 'yaw': float(yaw), 'scale': 1},
                    route=route.tolist(), routeDistances=target_t.tolist(), routeLength=length,
                    mouths=mouths,
                    bends=bends, mesh={'triangles': len(mesh.faces), 'vertices': len(mesh.vertices),
                    'bytes': (PUBLIC / 'cave.glb').stat().st_size, 'boundaryEdges': len(boundary),
                    'nonmanifoldEdges': int((edge_counts > 2).sum()),
                    'minHeight': float(final_heights[inside].min()), 'minWidth': float(final_widths[inside].min()),
                    'slopeMedian': float(np.median(slopes)), 'slopeP95': float(np.percentile(slopes, 95)),
                    'tint': 'Linear atlas colour, 35 cm spatial average, exposure normalized to mean 0.7'})
        print('Mesh', data['mesh'], 'bends', bends, flush=True)
    if not args.mesh_only:
        data['materials'] = textures(cache)
    data['downloadBytes'] = (PUBLIC / 'cave.glb').stat().st_size + sum(m['bytes'] for a in data.get('materials', []) for m in a['maps'].values())
    if data['mesh']['bytes'] > 4_000_000 or data['downloadBytes'] > 18_000_000:
        raise ValueError('Cave asset budget exceeded')
    DATA.write_text(json.dumps(data, indent=2) + '\n')
    print('Total cave bytes', data['downloadBytes'], flush=True)


if __name__ == '__main__':
    main()
