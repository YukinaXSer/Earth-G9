import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('prep', Path(__file__).resolve().parents[1] / 'src/cave/prepare-outcrop.py')
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


class ScanPreparationTests(unittest.TestCase):
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
