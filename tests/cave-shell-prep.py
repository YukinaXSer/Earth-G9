import importlib.util
from pathlib import Path
import sys
import unittest

import numpy as np
import trimesh

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('shell', Path(__file__).resolve().parents[1] / 'scripts/prepare-mountain-shell.py')
shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell)


class ShellPreparationTests(unittest.TestCase):
    def setUp(self):
        self.volume = dict(route=[[0, 0, 0], [0, 0, 10]], side=[[1, 0, 0]] * 2,
                           radius=[[4] * 64] * 2, axisHeight=1.1)
        self.mouths = [dict(floorCenter=[0, 0, 0], outward=[0, 0, -1]),
                       dict(floorCenter=[0, 0, 10], outward=[0, 0, 1])]

    def test_upper_shell_overlap_preserves_walkable_headroom(self):
        points = np.array([[0., 1.8, 10], [0, 4.5, 10]])
        result = shell.shell_margin(points, self.volume, self.mouths)
        self.assertLess(result[0], 0)
        self.assertGreater(result[1], 0)
        self.assertEqual(len(shell.shell_margin(np.empty((0, 3)), self.volume, self.mouths)), 0)

    def test_refinement_only_subdivides_original_scanned_surface(self):
        mesh = trimesh.Trimesh([[1., 4.5, 10], [3, 4.5, 10], [1, 6.5, 10]], [[0, 1, 2]], process=False)
        result, colors = shell.refine(mesh, np.full((3, 3), .5), self.volume, self.mouths, edge_length=.5)
        self.assertGreater(len(result.faces), 1)
        np.testing.assert_allclose(result.vertices[:, 2], 10)
        barycentric = trimesh.triangles.points_to_barycentric(np.repeat(mesh.triangles, len(result.vertices), axis=0), result.vertices)
        self.assertGreaterEqual(barycentric.min(), -1e-10)
        np.testing.assert_allclose(colors, .5)

    def test_invalid_shell_dimensions_fail_before_loading_assets(self):
        for height, burial in [(-1, .7), (13, .4), (float('nan'), .7)]:
            with self.assertRaises(ValueError):
                shell.prepare(height, burial)


if __name__ == '__main__':
    unittest.main()
