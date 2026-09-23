"""
Lightweight NLP for TraceMate.

This intentionally uses only the Python standard library so the AI service
can start reliably even when optional ML packages are unavailable.

Pipeline:
1. lowercase / normalize
2. tokenize
3. remove common stop words
4. lightweight suffix normalization
5. TF-IDF cosine similarity
6. weighted token-overlap score

This is an NLP baseline, not a claim of transformer-level semantic accuracy.
A future SBERT model can replace this module without changing the API.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Dict, List, Tuple


STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "had", "has", "have", "i", "in", "is", "it", "its", "near", "of",
    "on", "or", "that", "the", "this", "to", "was", "were", "with",
    "my", "me", "very", "item", "found", "lost",
}


SYNONYMS = {
    "backpack": "bag",
    "rucksack": "bag",
    "handbag": "bag",
    "purse": "bag",
    "mobile": "phone",
    "cellphone": "phone",
    "smartphone": "phone",
    "notebook": "laptop",
    "macbook": "laptop",
    "spectacles": "glasses",
    "eyeglasses": "glasses",
    "wallets": "wallet",
    "keys": "key",
}


def _normalize_token(token: str) -> str:
    token = token.lower().strip()

    if token in SYNONYMS:
        return SYNONYMS[token]

    # Small, deterministic suffix normalization. This is deliberately
    # conservative so words such as "glass" are not damaged.
    for suffix in ("ingly", "edly", "ing", "ed", "es", "s"):
        if len(token) > len(suffix) + 3 and token.endswith(suffix):
            candidate = token[: -len(suffix)]
            if candidate.endswith("i") and suffix == "es":
                candidate = candidate[:-1] + "y"
            return candidate

    return token


def tokenize(text: str) -> List[str]:
    raw = re.findall(r"[a-z0-9]+", (text or "").lower())

    result: List[str] = []
    for token in raw:
        if token in STOP_WORDS:
            continue
        normalized = _normalize_token(token)
        if len(normalized) >= 2 and normalized not in STOP_WORDS:
            result.append(normalized)

    return result


def _tfidf_vectors(tokens1: List[str], tokens2: List[str]) -> Tuple[Dict[str, float], Dict[str, float]]:
    docs = [Counter(tokens1), Counter(tokens2)]
    vocabulary = sorted(set(tokens1) | set(tokens2))

    vectors = [{}, {}]
    total_docs = 2

    for term in vocabulary:
        document_frequency = sum(1 for doc in docs if doc.get(term, 0) > 0)
        idf = math.log((total_docs + 1) / (document_frequency + 1)) + 1.0

        for index, doc in enumerate(docs):
            total_terms = sum(doc.values()) or 1
            tf = doc.get(term, 0) / total_terms
            vectors[index][term] = tf * idf

    return vectors[0], vectors[1]


def _cosine(vector1: Dict[str, float], vector2: Dict[str, float]) -> float:
    if not vector1 or not vector2:
        return 0.0

    dot = sum(vector1.get(k, 0.0) * vector2.get(k, 0.0) for k in vector1)
    norm1 = math.sqrt(sum(v * v for v in vector1.values()))
    norm2 = math.sqrt(sum(v * v for v in vector2.values()))

    if norm1 == 0.0 or norm2 == 0.0:
        return 0.0

    return max(0.0, min(1.0, dot / (norm1 * norm2)))


def compare_texts(text1: str, text2: str) -> dict:
    tokens1 = tokenize(text1)
    tokens2 = tokenize(text2)

    if not tokens1 or not tokens2:
        return {
            "model": "TraceMate NLP TF-IDF baseline",
            "method": "token normalization + TF-IDF cosine similarity",
            "similarity": 0.0,
            "similarity_percent": 0.0,
            "token_overlap_percent": 0.0,
            "tokens1": tokens1,
            "tokens2": tokens2,
            "match": False,
        }

    vector1, vector2 = _tfidf_vectors(tokens1, tokens2)
    cosine = _cosine(vector1, vector2)

    set1 = set(tokens1)
    set2 = set(tokens2)
    union = set1 | set2
    overlap = (len(set1 & set2) / len(union)) if union else 0.0

    # Blend two interpretable NLP signals.
    similarity = max(0.0, min(1.0, (0.7 * cosine) + (0.3 * overlap)))
    percent = round(similarity * 100.0, 2)

    return {
        "model": "TraceMate NLP TF-IDF baseline",
        "method": "token normalization + TF-IDF cosine similarity",
        "similarity": round(similarity, 6),
        "similarity_percent": percent,
        "token_overlap_percent": round(overlap * 100.0, 2),
        "tokens1": tokens1,
        "tokens2": tokens2,
        "match": similarity >= 0.45,
    }
