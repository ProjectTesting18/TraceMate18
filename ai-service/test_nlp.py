import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.nlp_service import compare_texts


def test_similar_descriptions():
    result = compare_texts(
        "black Nike backpack near college library",
        "black backpack with Nike logo found near library",
    )
    assert result["similarity_percent"] >= 50
    assert result["match"] is True


def test_different_descriptions():
    result = compare_texts(
        "red water bottle near sports ground",
        "silver laptop in computer lab",
    )
    assert result["similarity_percent"] < 50


if __name__ == "__main__":
    test_similar_descriptions()
    test_different_descriptions()
    print("NLP tests passed.")
