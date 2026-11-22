"""Orient the scan's existing seam-separated charts; requires numpy and scipy.

Only texture coordinates change. No generated trunk geometry or texture atlas.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

source = Path(sys.argv[1])
doc = json.loads(source.read_text())
binary = (source.parent / doc['buffers'][0]['uri']).read_bytes()
primitive = next(p for m in doc['meshes'] for p in m['primitives']
                 if doc['materials'][p['material']]['name'] == 'island_tree_02')


def accessor(index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dtype = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']])
    return np.ndarray((a['count'], size), dtype=dtype, buffer=binary,
                      offset=view.get('byteOffset', 0) + a.get('byteOffset', 0),
                      strides=(view.get('byteStride', dtype.itemsize * size), dtype.itemsize)).copy()


positions = accessor(primitive['attributes']['POSITION']).astype(float)
uv = accessor(primitive['attributes']['TEXCOORD_0']).astype(float)
faces = accessor(primitive['indices']).reshape(-1, 3)
edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
chart_graph = coo_matrix((np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(len(positions), len(positions)))
chart_count, chart = connected_components(chart_graph, directed=False)

# Weld only the distance graph across the artist's UV seams, not the mesh.
_, unique, welded = np.unique(np.round(positions, 5), axis=0, return_index=True, return_inverse=True)
points = positions[unique]
graph_edges = np.unique(np.sort(welded[edges], axis=1), axis=0)
graph_edges = graph_edges[graph_edges[:, 0] != graph_edges[:, 1]]
lengths = np.linalg.norm(points[graph_edges[:, 0]] - points[graph_edges[:, 1]], axis=1)
graph = coo_matrix((lengths, (graph_edges[:, 0], graph_edges[:, 1])), shape=(len(points), len(points))).tocsr()
roots = np.flatnonzero(points[:, 1] < points[:, 1].min() + .025)
distance = dijkstra(graph, directed=False, indices=roots, min_only=True)[welded]
if not np.isfinite(distance).all():
    raise ValueError('The source wood must form one connected growth surface')

area = np.linalg.norm(np.cross(positions[faces[:, 1]] - positions[faces[:, 0]],
                               positions[faces[:, 2]] - positions[faces[:, 0]]), axis=1) / 2
u = uv[faces[:, 1]] - uv[faces[:, 0]]
v = uv[faces[:, 2]] - uv[faces[:, 0]]
uv_area = np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]) / 2
weights = np.bincount(faces.flatten(), weights=np.repeat(area / 3, 3), minlength=len(positions))
result = np.zeros_like(uv)
charts = []
for index in range(chart_count):
    selected = chart == index
    triangles = chart[faces[:, 0]] == index
    weight = weights[selected]
    if weight.sum() <= 0 or uv_area[triangles].sum() <= 0:
        raise ValueError('Degenerate source UV chart')
    mean_uv = np.average(uv[selected], axis=0, weights=weight)
    mean_distance = np.average(distance[selected], weights=weight)
    coords = uv[selected] - mean_uv
    target = distance[selected] - mean_distance
    gradient = np.linalg.lstsq(coords * np.sqrt(weight[:, None]), target * np.sqrt(weight), rcond=None)[0]
    if np.linalg.norm(gradient) < 1e-6:
        _, vectors = np.linalg.eigh((coords * weight[:, None]).T @ coords)
        gradient = vectors[:, -1]
    direction = gradient / np.linalg.norm(gradient)
    across = np.array([direction[1], -direction[0]])
    scale = np.sqrt(area[triangles].sum() / uv_area[triangles].sum())
    result[selected, 0] = coords @ across * scale
    result[selected, 1] = coords @ direction * scale + mean_distance
    error = np.sqrt(np.average((coords @ gradient - target) ** 2, weights=weight))
    charts.append({'vertices': int(selected.sum()), 'metresPerUVUnit': float(scale), 'growthFitRmsMetres': float(error)})

if not np.isfinite(result).all():
    raise ValueError('Non-finite branch UV coordinates')
print(json.dumps({'uvs': result.tolist(), 'charts': charts}, separators=(',', ':')))
