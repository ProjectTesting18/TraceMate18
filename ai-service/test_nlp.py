"""Functional regression tests for TraceMate text matching.

These tests do not claim to measure SBERT benchmark accuracy. They verify the
runtime contract and safety rules using the installed model when available and
the deterministic fallback otherwise.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.nlp_service import compare_texts, _tfidf_compare, _decide_match, _object_groups


class NLPMatchingTests(unittest.TestCase):
    def test_similar_descriptions_are_candidates(self):
        result = compare_texts(
            "black Nike backpack near college library",
            "black backpack with Nike logo found near library",
        )
        self.assertGreaterEqual(result["similarity_percent"], 35)
        self.assertTrue(result["match"])
        self.assertIn(result["backend"], {"sbert", "tfidf_fallback"})

    def test_explicit_conflicting_object_types_are_not_matches(self):
        result = _tfidf_compare(
            "red water bottle near sports ground",
            "silver laptop in computer lab",
        )
        result["match"] = _decide_match(
            "red water bottle near sports ground",
            "silver laptop in computer lab",
            result,
        )
        self.assertFalse(result["match"])

    def test_headphone_synonyms_are_candidate_compatible(self):
        lost = "black Swiss Military brand headphones"
        found = "black wired earphones with inline control"
        result = _tfidf_compare(lost, found)
        # A lexical fallback cannot prove identity from weak text overlap, but
        # it must not classify the two descriptions as conflicting object types.
        groups_lost = _object_groups(result["tokens1"])
        groups_found = _object_groups(result["tokens2"])
        self.assertIn("audio_device", groups_lost)
        self.assertIn("audio_device", groups_found)
        self.assertFalse(groups_lost.isdisjoint(groups_found))

    def test_empty_descriptions_do_not_match(self):
        result = _tfidf_compare("", "black headphones")
        result["match"] = _decide_match("", "black headphones", result)
        self.assertFalse(result["match"])
        self.assertEqual(result["similarity_percent"], 0.0)

    def test_similarity_is_bounded(self):
        for a, b in [("black headphones", "black headphones"), ("wallet", "laptop"), ("", "")]:
            result = compare_texts(a, b)
            self.assertGreaterEqual(result["similarity_percent"], 0.0)
            self.assertLessEqual(result["similarity_percent"], 100.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
