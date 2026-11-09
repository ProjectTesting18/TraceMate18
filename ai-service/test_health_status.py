"""Regression tests: health checks must not trigger large model downloads."""
import unittest

from services import cnn_service, nlp_service


class HealthStatusTests(unittest.TestCase):
    def test_visual_health_does_not_initialize_lazy_models(self):
        # The status check must only inspect the caches, not invoke loaders.
        if cnn_service._CNN_MODEL_CACHE is not cnn_service._MODEL_UNSET:
            self.skipTest("MobileNet loader was already initialized in this process")
        if cnn_service._CLIP_MODEL_CACHE is not cnn_service._MODEL_UNSET:
            self.skipTest("CLIP loader was already initialized in this process")

        status = cnn_service.get_visual_model_status()

        self.assertFalse(status["mobilenet_v2"]["initialized"])
        self.assertFalse(status["clip"]["initialized"])
        self.assertIn("not initialized", status["mobilenet_v2"]["model"])
        self.assertIn("not initialized", status["clip"]["model"])
        self.assertIs(cnn_service._CNN_MODEL_CACHE, cnn_service._MODEL_UNSET)
        self.assertIs(cnn_service._CLIP_MODEL_CACHE, cnn_service._MODEL_UNSET)

    def test_nlp_health_does_not_attempt_sbert_load(self):
        if nlp_service._SBERT_LOAD_ATTEMPTED:
            self.skipTest("SBERT loader was already attempted in this process")

        status = nlp_service.get_nlp_status()

        self.assertFalse(status["initialized"])
        self.assertFalse(status["sbert_available"])
        self.assertTrue(status["fallback_available"])
        self.assertFalse(nlp_service._SBERT_LOAD_ATTEMPTED)
        self.assertIn("lazy", status["active_model"])


if __name__ == "__main__":
    unittest.main()
