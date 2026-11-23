import importlib.util
from pathlib import Path
import unittest
import sys

import numpy as np

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('burial', Path(__file__).resolve().parents[1] / 'scripts/bury-mountain-shell.py')
burial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(burial)


class FloorBurialTests(unittest.TestCase):
    def setUp(self):
        self.route = [[0, 0, 0], [0, 0, 10]]
        self.mouth = {'floorCenter': [0, 0, 10]}

    def test_low_flanks_lower_without_moving_roof_route_or_horizontal_coordinates(self):
        vertices = np.array([[2., 0, 10], [2, 1, 10], [2, 1.5, 10], [0, 0, 10], [2, 5, 10]])
        before = vertices.copy()
        result = burial.bury(vertices, self.route, self.mouth)
        np.testing.assert_allclose(result[:, 1], [-1.5, .25, 1.5, 0, 5])
        np.testing.assert_equal(result[:, [0, 2]], vertices[:, [0, 2]])
        np.testing.assert_equal(vertices, before)

    def test_empty_and_zero_burial_preserve_vertices(self):
        self.assertEqual(burial.bury(np.empty((0, 3)), self.route, self.mouth).shape, (0, 3))
        vertices = np.array([[2., 0, 10]])
        np.testing.assert_equal(burial.bury(vertices, self.route, self.mouth, 0), vertices)

    def test_invalid_burial_and_route_are_rejected(self):
        for amount in [-1, float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                burial.bury(np.array([[2., 0, 10]]), self.route, self.mouth, amount)
        with self.assertRaises(ValueError):
            burial.bury(np.array([[2., 0, 10]]), [], self.mouth)


if __name__ == '__main__':
    unittest.main()
