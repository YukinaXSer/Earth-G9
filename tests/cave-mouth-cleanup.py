import importlib.util
from pathlib import Path
import unittest
import sys

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


forest = load('clean-forest-scan')
mountain = load('prepare-native-mountain-mouth')


class MouthCleanupTests(unittest.TestCase):
    def test_supported_scan_islands_keep_only_substantial_touching_components(self):
        mesh = trimesh.Trimesh([[0., 0, 0], [2, 0, 0], [0, 0, 2],
                               [5, 0, 0], [7, 0, 0], [5, 0, 2],
                               [0, 0, .01], [.01, 0, .01], [0, 0, .02]],
                              [[0, 1, 2], [3, 4, 5], [6, 7, 8]], process=False)
        np.testing.assert_array_equal(forest.supported_islands(mesh, [[0., 0, 0]]), [True, False, False])
        self.assertFalse(forest.supported_islands(mesh, []).any())
        empty = trimesh.Trimesh(np.empty((0, 3)), np.empty((0, 3), dtype=int), process=False)
        self.assertEqual(len(forest.supported_islands(empty, [[0., 0, 0]])), 0)
        with self.assertRaises(ValueError):
            forest.supported_islands(mesh, [], contact=float('nan'))

    def test_natural_grounded_floor_islands_survive_entrance_cleanup(self):
        mesh = trimesh.Trimesh([[0., 0, 0], [2, 0, 0], [0, 0, 2],
                               [5, 0, 0], [7, 0, 0], [5, 0, 2],
                               [10, 3, 0], [12, 3, 0], [10, 3, 2]],
                              [[0, 1, 2], [3, 5, 4], [6, 8, 7]], process=False)
        np.testing.assert_array_equal(forest.entrance_islands(mesh, 0), [True, True, False])

    def test_recess_removes_straddling_wall_triangles_but_preserves_walkable_floor(self):
        vertices = [[0., 2, -1], [1, 2, -4], [0, 3, -4],
                    [0, 2, -3], [1, 2, -3], [0, 3, -3],
                    [0, 0, 0], [0, 0, -1], [1, 0, 0]]
        mesh = trimesh.Trimesh(vertices, [[0, 1, 2], [3, 4, 5], [6, 8, 7]], process=False)
        mouth = dict(floorCenter=[0, 0, 0], outward=[0, 0, 1])
        keep = mountain.recess_faces(mesh, mouth, 1.75)
        np.testing.assert_array_equal(keep, [False, True, True])
        before = mesh.triangles.copy()
        mesh.update_faces(keep)
        np.testing.assert_array_equal(mesh.triangles, before[keep])
        empty = trimesh.Trimesh(np.empty((0, 3)), np.empty((0, 3), dtype=int), process=False)
        self.assertEqual(len(mountain.recess_faces(empty, mouth, 1)), 0)
        with self.assertRaises(ValueError):
            mountain.recess_faces(mesh, mouth, -1)


if __name__ == '__main__':
    unittest.main()
