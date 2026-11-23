import importlib.util
from pathlib import Path
import unittest
import tempfile

import numpy as np

spec = importlib.util.spec_from_file_location('prep', Path(__file__).resolve().parents[1] / 'src/cave/prepare-outcrop.py')
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


class ScanPreparationTests(unittest.TestCase):
    def test_export_keeps_scan_triangles_and_route_attributes_without_unused_vertices(self):
        mesh = prep.trimesh.Trimesh([[0., 0, -1], [1, 0, -1], [0, 0, -2], [100, 100, 100]], [[0, 1, 2]], process=False)
        before = mesh.triangles.copy()
        route = np.array([[0., 0, 0], [0, 0, -4]])
        volume = dict(route=route, side=[[1, 0, 0]] * 2, radius=[[2] * 64] * 2, axisHeight=1.1)
        mouths = [dict(floorCenter=route[0], outward=[0, 0, 1]), dict(floorCenter=route[1], outward=[0, 0, -1])]
        class Pipeline:
            def route_parameters(self, vertices, route):
                return np.zeros(len(vertices))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'scan.glb'
            prep.export(path, mesh, np.full((4, 3), 128), route, Pipeline(), volume, mouths, 1)
            loaded = prep.trimesh.load(path, force='mesh', process=False)
            self.assertEqual(len(loaded.vertices), 3)
            np.testing.assert_array_equal(loaded.triangles, before)
            self.assertEqual(len(loaded.vertex_attributes['_CAVE_ROUTE']), 3)

    def test_snapped_slivers_are_deleted_without_removing_regular_or_unmoved_faces(self):
        vertices = np.array([[0., 0, 0], [1., 0, 0], [.5, 1, 0], [1., .001, 0]])
        mesh = prep.trimesh.Trimesh(vertices, [[0, 1, 2], [0, 1, 3]], process=False)
        np.testing.assert_array_equal(prep.rim_slivers(mesh, np.ones(4, dtype=bool)), [False, True])
        np.testing.assert_array_equal(prep.rim_slivers(mesh, np.zeros(4, dtype=bool)), [False, False])
        empty = prep.trimesh.Trimesh(np.empty((0, 3)), np.empty((0, 3), dtype=int), process=False)
        self.assertEqual(len(prep.rim_slivers(empty, np.empty(0, dtype=bool))), 0)

    def test_macro_tint_preserves_broad_colour_without_nearest_texel_blocks(self):
        vertices = np.array([[0., 0, 0], [.01, 0, 0], [1., 0, 0], [2., 0, 0]])
        colors = np.array([[0., 0, 0], [255., 255, 255], [140., 140, 140], [180., 180, 180]])
        result = prep.smooth_macro_tint(vertices, colors)
        self.assertLess(abs(result[0, 0] - result[1, 0]), 2)
        self.assertTrue(np.all(np.isfinite(result)))
        self.assertGreaterEqual(result.min(), 0)
        self.assertLessEqual(result.max(), 255)
        self.assertEqual(prep.smooth_macro_tint(np.empty((0, 3)), np.empty((0, 3))).shape, (0, 3))
        np.testing.assert_allclose(prep.smooth_macro_tint(vertices, np.full((4, 3), 100)), 100)


if __name__ == '__main__':
    unittest.main()
