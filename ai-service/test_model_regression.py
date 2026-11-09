"""Offline regression checks for CNN/CLIP hybrid utilities and visual details.

Does not download pretrained weights. Full pretrained-model evaluation requires
those model dependencies/weights plus the original image dataset.
"""
import os
import sys
import unittest
from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from services.cnn_service import _fallback_embedding, cosine_similarity, hybrid_visual_similarity, similarity_percentage as cnn_similarity_percentage
from services.image_similarity import compare_clip_embeddings, similarity_percentage as clip_similarity_percentage
from services.visual_details import extract_visual_details


def image_bytes(image):
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


class VisualRegressionTests(unittest.TestCase):
    def test_same_image_embedding_is_identical(self):
        image = Image.new("RGB", (128, 128), (250, 250, 250))
        ImageDraw.Draw(image).rectangle((35, 30, 90, 95), fill=(10, 10, 10))
        a = _fallback_embedding(image)
        b = _fallback_embedding(image.copy())
        self.assertAlmostEqual(float(cosine_similarity(a, b)), 1.0, places=5)

    def test_distinct_color_fixture_changes_fallback_embedding(self):
        black = Image.new("RGB", (128, 128), (0, 0, 0))
        white = Image.new("RGB", (128, 128), (255, 255, 255))
        a = _fallback_embedding(black)
        b = _fallback_embedding(white)
        self.assertLess(float(cosine_similarity(a, b)), 0.999)


    def test_orthogonal_embeddings_are_not_reported_as_fifty_percent(self):
        self.assertEqual(cnn_similarity_percentage(0.0), 0.0)
        self.assertEqual(clip_similarity_percentage(0.0), 0.0)
        self.assertEqual(cnn_similarity_percentage(1.0), 100.0)
        self.assertEqual(clip_similarity_percentage(-0.5), 0.0)
        self.assertEqual(cnn_similarity_percentage(0.75), 75.0)

    def test_hybrid_uses_available_models_and_reports_components(self):
        both = hybrid_visual_similarity(90.0, 70.0)
        self.assertTrue(both["available"])
        self.assertAlmostEqual(both["similarity_percentage"], 78.0, places=2)
        only_clip = hybrid_visual_similarity(None, 73.5)
        self.assertEqual(only_clip["similarity_percentage"], 73.5)
        neither = hybrid_visual_similarity(None, None)
        self.assertFalse(neither["available"])

    def test_clip_embedding_comparison_is_repeatable(self):
        embedding = [1.0, 0.0, 0.0]
        result = compare_clip_embeddings(embedding, embedding)
        self.assertAlmostEqual(result["cosine_similarity"], 1.0, places=5)
        self.assertEqual(result["similarity_percentage"], 100.0)

    def test_visual_details_endpoint_handles_valid_image(self):
        image = Image.new("RGB", (128, 128), (240, 240, 240))
        ImageDraw.Draw(image).ellipse((40, 30, 90, 95), fill=(5, 5, 5))
        result = extract_visual_details(image_bytes=image_bytes(image))
        self.assertIsInstance(result, dict)
        self.assertIn("foreground_color", result)
        self.assertIn("scratchScreening", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
