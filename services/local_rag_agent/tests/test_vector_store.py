from __future__ import annotations

import math
import unittest

from services.local_rag_agent.vector_store import _normalise_score


class ScoreNormalisationTests(unittest.TestCase):
    def test_cosine_distance_is_scaled(self) -> None:
        result = _normalise_score("cosine", 0.3)
        expected = (1.0 - 0.3 + 1.0) / 2.0
        self.assertAlmostEqual(result, expected, places=6)

    def test_cosine_values_are_clamped(self) -> None:
        result = _normalise_score("COSINE", 5.0)
        self.assertAlmostEqual(result, 0.0, places=6)

    def test_l2_distance_is_inverted(self) -> None:
        result = _normalise_score("l2", 3.0)
        self.assertAlmostEqual(result, 1.0 / 4.0, places=6)

    def test_other_metrics_pass_through(self) -> None:
        value = _normalise_score("IP", 42.0)
        self.assertTrue(math.isclose(value, 42.0))


if __name__ == "__main__":
    unittest.main()
