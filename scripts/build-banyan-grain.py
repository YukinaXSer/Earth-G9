"""Add metre-scale grain coordinates to the existing scan, without changing faces.

Authoring only: numpy, scipy, Pillow and xatlas. Runtime reuses the loaded scan.
"""
import hashlib
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, sobel
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra, minimum_spanning_tree
import xatlas


source = Path(sys.argv[1] if len(sys.argv) > 1 else 'public/models/captured-banyan-low.glb')
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'public/models/near-banyan-grain.glb')
raw = source.read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + length])
binary = raw[28 + length:]
p = doc['meshes'][0]['primitives'][0]


def accessor(index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dtype = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5122: '<i2', 5121: 'u1'}[a['componentType']])
    data = np.ndarray((a['count'], size), dtype=dtype, buffer=binary,
                      offset=view.get('byteOffset', 0) + a.get('byteOffset', 0),
                      strides=(view.get('byteStride', dtype.itemsize * size), dtype.itemsize)).astype(float)
    return np.maximum(-1, data / np.iinfo(dtype).max) if a.get('normalized') else data


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def cross2(a, b):
    return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


grain_path = source.parent.parent / 'textures/near-banyan-color.jpg'
normal_path = grain_path.with_name('near-banyan-normal.jpg')
if len(sys.argv) > 4:
    # Optional official Fever Tree Bark diffuse/OpenGL-normal JPEG inputs.
    rgb = np.asarray(Image.open(sys.argv[4]).convert('RGB'), dtype=np.float32) / 255
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    local = gaussian_filter(linear, (32, 32, 0), mode='wrap')
    detail = .25 * linear / np.maximum(local, .0001)
    detail = np.clip(detail, 0, 1)
    srgb = np.where(detail <= .0031308, detail * 12.92, 1.055 * detail ** (1 / 2.4) - .055)
    Image.fromarray(np.round(srgb * 255).astype('uint8')).save(grain_path, quality=90, subsampling=0, optimize=True)
    normal = np.asarray(Image.open(sys.argv[5]).convert('RGB'), dtype=np.float32) / 127.5 - 1
    slopes = normal[:, :, :2] / np.maximum(normal[:, :, 2:], .1)
    slopes -= gaussian_filter(slopes, (32, 32, 0), mode='wrap')
    normal = np.concatenate([slopes, np.ones((*slopes.shape[:2], 1))], axis=2)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    Image.fromarray(np.round(np.clip(normal * .5 + .5, 0, 1) * 255).astype('uint8')).save(normal_path, quality=90, subsampling=0, optimize=True)

grain_raw = grain_path.read_bytes()
grain = np.asarray(Image.open(io.BytesIO(grain_raw)).convert('RGB'), dtype=float) / 255
grain_linear = np.where(grain <= .04045, grain / 12.92, ((grain + .055) / 1.055) ** 2.4)
grain_mean = grain_linear.mean(axis=(0, 1)).tolist()
gray = gaussian_filter(np.log(np.maximum(grain_linear @ [.2126, .7152, .0722], .0001)), 1, mode='wrap')
dx, dy = sobel(gray, axis=1, mode='wrap'), -sobel(gray, axis=0, mode='wrap')
_, eigenvectors = np.linalg.eigh([[np.mean(dx * dx), np.mean(dx * dy)], [np.mean(dx * dy), np.mean(dy * dy)]])
fiber = eigenvectors[:, 0]
fiber *= np.sign(fiber[np.argmax(np.abs(fiber))])
grain_rotation = np.array([[fiber[1], fiber[0]], [-fiber[0], fiber[1]]])
grain_metres = 1.36


positions = accessor(p['attributes']['POSITION'])
normals = accessor(p['attributes']['NORMAL'])
original_uv = accessor(p['attributes']['TEXCOORD_0'])
faces = accessor(p['indices']).astype(np.uint32).reshape(-1, 3)
bottom, top = positions.min(axis=0), positions.max(axis=0)
scale = 12 / (top[1] - bottom[1])
positions = (positions - [(bottom[0] + top[0]) / 2, bottom[1], (bottom[2] + top[2]) / 2]) * scale

# Welding is only for parameterization; output addresses original face corners.
_, unique, welded = np.unique(np.round(positions, 5), axis=0, return_index=True, return_inverse=True)
points = positions[unique]
area = np.linalg.norm(np.cross(positions[faces[:, 1]] - positions[faces[:, 0]],
                               positions[faces[:, 2]] - positions[faces[:, 0]]), axis=1) / 2
valid = np.flatnonzero(area > 1e-9)
triangles = welded[faces[valid]]
edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
edges = np.unique(np.sort(edges, axis=1), axis=0)
lengths = np.linalg.norm(points[edges[:, 0]] - points[edges[:, 1]], axis=1)
graph = coo_matrix((lengths, (edges[:, 0], edges[:, 1])), shape=(len(points), len(points))).tocsr()
count, component = connected_components(graph, directed=False)
highest = np.full(count, -np.inf)
np.maximum.at(highest, component, points[:, 1])
seeds = np.flatnonzero(points[:, 1] >= highest[component] - .02)
distance = dijkstra(graph, directed=False, indices=seeds, min_only=True)
if not np.isfinite(distance).all():
    raise ValueError('Non-finite scan growth distance')

image = doc['images'][0]
view = doc['bufferViews'][image['bufferView']]
color = np.asarray(Image.open(io.BytesIO(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])).convert('RGB')) / 255
height, width = color.shape[:2]
pixels = color[np.clip((original_uv[:, 1] * height).astype(int), 0, height - 1),
               np.clip((original_uv[:, 0] * width).astype(int), 0, width - 1)]
green = (pixels[:, 1] - pixels[:, 0]) / np.maximum(pixels[:, 1], .01)
wood = (1 - smoothstep(.08, .23, green)) * np.maximum(
    smoothstep(1.15, 1.6, positions[:, 1]),
    (1 - smoothstep(.35, .85, np.abs(normals[:, 1]))) * smoothstep(.65, 1.0, positions[:, 1]))
component_area = np.bincount(component[triangles[:, 0]], weights=area[valid], minlength=count)
wood *= smoothstep(.005, .03, component_area[component[welded]])
wood *= 1 - smoothstep(4.5, 5.5, positions[:, 1])
valid = valid[(area[valid] > 1e-6) & (wood[faces[valid]].max(axis=1) > .02)]
triangles = welded[faces[valid]]
used = np.unique(triangles)
compact = np.full(len(points), -1, dtype=np.int64)
compact[used] = np.arange(len(used))
print(json.dumps({'stage': 'unwrap reachable wood', 'faces': len(valid), 'vertices': len(used)}), flush=True)

cache = Path(sys.argv[3]) if len(sys.argv) > 3 else None
source_hash = hashlib.sha256(raw).hexdigest()
face_hash = hashlib.sha256(triangles.tobytes()).hexdigest()
if cache and cache.exists():
    saved = np.load(cache)
    if str(saved['source_hash']) != source_hash or str(saved['face_hash']) != face_hash:
        raise ValueError('Stale parameterization cache')
    mapping, indices, uv, chart = (saved[k] for k in ['mapping', 'indices', 'uv', 'chart'])
    chart_count = int(saved['chart_count'])
else:
    atlas = xatlas.Atlas()
    atlas.add_mesh(points[used].astype(np.float32), compact[triangles].astype(np.uint32))
    options, packing = xatlas.ChartOptions(), xatlas.PackOptions()
    options.max_iterations = 1
    packing.resolution, packing.max_chart_size = 512, 64
    atlas.generate(chart_options=options, pack_options=packing, verbose=True)
    mapping, indices, uv = atlas[0]
    mapping = used[mapping]
    _, chart = atlas.get_mesh_vertex_assignment(0)
    chart_count = atlas.get_mesh_chart_count(0)
    if cache:
        np.savez_compressed(cache, source_hash=source_hash, face_hash=face_hash, mapping=mapping, indices=indices, uv=uv, chart=chart, chart_count=chart_count)
mapped = mapping[indices]
if mapped.shape != triangles.shape or not np.array_equal(np.sort(mapped, axis=1), np.sort(triangles, axis=1)):
    raise ValueError('Parameterization must retain every original face')

weights = np.bincount(indices.flatten(), weights=np.repeat(area[valid] / 3, 3), minlength=len(mapping))
u = np.zeros(len(mapping))
v = distance[mapping]
safe_v = np.zeros(len(mapping))
uv_area = np.abs(cross2(uv[indices[:, 1]] - uv[indices[:, 0]], uv[indices[:, 2]] - uv[indices[:, 0]])) / 2
vertex_order = np.argsort(chart, kind='stable')
boundaries = np.r_[0, np.flatnonzero(np.diff(chart[vertex_order])) + 1, len(chart)]
triangle_chart = chart[indices[:, 0]]
physical_area = np.bincount(triangle_chart, weights=area[valid], minlength=chart_count)
parameter_area = np.bincount(triangle_chart, weights=uv_area, minlength=chart_count)
for begin, end in zip(boundaries[:-1], boundaries[1:]):
    selected = vertex_order[begin:end]
    index = int(chart[selected[0]])
    weight = weights[selected]
    if weight.sum() <= 0 or parameter_area[index] <= 0:
        continue
    coords = uv[selected] - np.average(uv[selected], axis=0, weights=weight)
    target = v[selected] - np.average(v[selected], weights=weight)
    gradient = np.linalg.lstsq(coords * np.sqrt(weight[:, None]), target * np.sqrt(weight), rcond=None)[0]
    if np.linalg.norm(gradient) < 1e-8:
        _, vectors = np.linalg.eigh((coords * weight[:, None]).T @ coords)
        gradient = vectors[:, -1]
    direction = gradient / np.linalg.norm(gradient)
    metric = np.sqrt(physical_area[index] / parameter_area[index])
    u[selected] = coords @ [direction[1], -direction[0]] * metric
    safe_v[selected] = coords @ direction * metric + np.average(v[selected], weights=weight)

# Align chart phases along a maximum shared-boundary forest, leaving cycle cuts.
order = np.argsort(mapping, kind='stable')
cuts = np.r_[0, np.flatnonzero(np.diff(mapping[order])) + 1, len(order)]
seams = {}
for begin, end in zip(cuts[:-1], cuts[1:]):
    group = order[begin:end]
    a = int(group[0])
    for b in group[1:]:
        ca, cb = int(chart[a]), int(chart[b])
        if ca == cb:
            continue
        delta = float(u[a] - u[b])
        if ca > cb:
            ca, cb, delta = cb, ca, -delta
        total, n = seams.get((ca, cb), (0., 0))
        seams[ca, cb] = total + delta, n + 1
offset = np.zeros(chart_count)
if seams:
    pairs = np.asarray(list(seams), dtype=int)
    tree = minimum_spanning_tree(coo_matrix(([-seams[tuple(k)][1] for k in pairs], (pairs[:, 0], pairs[:, 1])), shape=(chart_count, chart_count))).tocoo()
    adjacency = [[] for _ in range(chart_count)]
    for a, b in zip(tree.row, tree.col):
        total, n = seams[int(a), int(b)]
        adjacency[a].append((b, total / n))
        adjacency[b].append((a, -total / n))
    seen = set()
    for root in range(chart_count):
        if root in seen:
            continue
        stack = [root]
        seen.add(root)
        while stack:
            a = stack.pop()
            for b, delta in adjacency[a]:
                if b not in seen:
                    seen.add(b)
                    offset[b] = offset[a] + delta
                    stack.append(b)
u += offset[chart]

result = np.zeros((faces.size, 3), dtype='<f4')
result.reshape(-1, 3, 3)[:, 1, 0] = 1
result.reshape(-1, 3, 3)[:, 2, 1] = 1
fallback_v = np.zeros(faces.size)
for corner in range(3):
    match = np.argmax(mapped == triangles[:, corner, None], axis=1)
    vertex = indices[np.arange(len(valid)), match]
    result[valid * 3 + corner, :2] = np.c_[u[vertex], v[vertex]]
    fallback_v[valid * 3 + corner] = safe_v[vertex]
    result[valid * 3 + corner, 2] = wood[faces[valid, corner]]
coordinates = result[:, :2].reshape(-1, 3, 2)
determinant = np.abs(cross2(coordinates[:, 1] - coordinates[:, 0], coordinates[:, 2] - coordinates[:, 0]))
flat = determinant[valid] < area[valid] * 1e-6
for corner in range(3):
    selected = valid[flat] * 3 + corner
    result[selected, 1] = fallback_v[selected]
result[:, :2] = result[:, :2] @ grain_rotation.T / grain_metres
if not np.isfinite(result).all():
    raise ValueError('Non-finite bark coordinates')
data = result.tobytes()
gltf = {'asset': {'version': '2.0', 'generator': 'Earth-G9 scan grain authoring', 'copyright': 'CC0 Ficus microcarpa scan by ffish.asia / floraZia.com'},
        'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [],
        'buffers': [{'byteLength': len(data)}],
        'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(data), 'byteStride': 12}],
        'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(result), 'type': 'VEC2'},
                      {'bufferView': 0, 'byteOffset': 8, 'componentType': 5126, 'count': len(result), 'type': 'SCALAR'}],
        'extras': {'sourceSha256': source_hash, 'sourceCorners': int(faces.size), 'charts': int(chart_count),
                   'grainSha256': hashlib.sha256(grain_raw).hexdigest(), 'grainMean': grain_mean,
                   'grainDirection': fiber.tolist(), 'grainMetres': grain_metres}}
meta = json.dumps(gltf, separators=(',', ':')).encode()
meta += b' ' * (-len(meta) % 4)
output.write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(meta) + len(data)) + struct.pack('<II', len(meta), 0x4e4f534a) + meta + struct.pack('<II', len(data), 0x004e4942) + data)
print(json.dumps({'charts': int(chart_count), 'geometryComponents': int(count), 'corners': len(result), 'bytes': output.stat().st_size, 'woodMean': float(result[:, 2].mean())}))
