"""
TraceMate NLP text matching.

Primary model:
    SBERT (Sentence-BERT) using all-MiniLM-L6-v2 for semantic similarity.

Fallback:
    A lightweight TF-IDF + token-overlap baseline is retained so the AI
    service can still start when sentence-transformers/model dependencies are
    unavailable.

The public compare_texts(text1, text2) API stays unchanged, so Node.js and
nlpBridge.js do not need to change when the NLP model changes.
"""

from __future__ import annotations

import math
import re
import threading
from collections import Counter
from typing import Dict, List, Tuple


# ============================================================
# OPTIONAL SBERT
# ============================================================

SBERT_MODEL_NAME = "all-MiniLM-L6-v2"
_SBERT_MODEL = None
_SBERT_LOAD_ATTEMPTED = False
_SBERT_LOAD_ERROR = ""
_SBERT_LOADING = False
_SBERT_LOCK = threading.Lock()


def _load_sbert_worker():
    """Load SBERT in a daemon thread so requests never wait on downloads."""
    global _SBERT_MODEL, _SBERT_LOAD_ATTEMPTED, _SBERT_LOAD_ERROR, _SBERT_LOADING
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(SBERT_MODEL_NAME)
        _SBERT_MODEL = model
        _SBERT_LOAD_ERROR = ""
    except Exception as exc:  # optional dependency/model download failure
        _SBERT_MODEL = None
        _SBERT_LOAD_ERROR = str(exc)
    finally:
        _SBERT_LOAD_ATTEMPTED = True
        _SBERT_LOADING = False


def _load_sbert():
    """Return a loaded model, or kick off one background load and return quickly."""
    global _SBERT_LOADING
    if _SBERT_MODEL is not None:
        return _SBERT_MODEL
    with _SBERT_LOCK:
        if not _SBERT_LOADING and not _SBERT_LOAD_ATTEMPTED:
            _SBERT_LOADING = True
            threading.Thread(
                target=_load_sbert_worker,
                name="tracemate-sbert-loader",
                daemon=True,
            ).start()
    return _SBERT_MODEL


def start_nlp_model_warmup() -> None:
    """Begin loading SBERT during AI-service startup; fallback stays available."""
    _load_sbert()


def get_nlp_status() -> dict:
    """Report NLP readiness without loading/downloading SBERT on health checks."""
    initialized = _SBERT_LOAD_ATTEMPTED
    model = _SBERT_MODEL

    if model is not None:
        active_model = f"SBERT {SBERT_MODEL_NAME}"
    elif initialized:
        active_model = "TraceMate NLP TF-IDF baseline"
    else:
        active_model = "TraceMate NLP (SBERT lazy; TF-IDF fallback ready)"

    return {
        "primary_model": SBERT_MODEL_NAME,
        "sbert_available": model is not None,
        "initialized": initialized,
        "loading": _SBERT_LOADING,
        "active_model": active_model,
        "fallback_available": True,
        "fallback": "TF-IDF + token overlap",
        "error": _SBERT_LOAD_ERROR if initialized else None,
    }


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
    "purse": "wallet",
    "mobile": "phone",
    "cellphone": "phone",
    "smartphone": "phone",
    # Keep paper notebooks distinct from electronic laptops.
    "macbook": "laptop",
    "spectacles": "glasses",
    "earbuds": "earphone",
    "earbud": "earphone",
    "earphones": "earphone",
    "headphones": "headphone",
    "headsets": "headset",
    "eyeglasses": "glasses",
    "wallets": "wallet",
    "keys": "key",
}


def _normalize_token(token: str) -> str:
    token = token.lower().strip()

    if token in SYNONYMS:
        return SYNONYMS[token]

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


def _tfidf_vectors(
    tokens1: List[str],
    tokens2: List[str],
) -> Tuple[Dict[str, float], Dict[str, float]]:
    docs = [Counter(tokens1), Counter(tokens2)]
    vocabulary = sorted(set(tokens1) | set(tokens2))

    vectors = [{}, {}]
    total_docs = 2

    for term in vocabulary:
        document_frequency = sum(
            1 for doc in docs if doc.get(term, 0) > 0
        )
        idf = math.log(
            (total_docs + 1) / (document_frequency + 1)
        ) + 1.0

        for index, doc in enumerate(docs):
            total_terms = sum(doc.values()) or 1
            tf = doc.get(term, 0) / total_terms
            vectors[index][term] = tf * idf

    return vectors[0], vectors[1]


def _cosine(
    vector1: Dict[str, float],
    vector2: Dict[str, float],
) -> float:
    if not vector1 or not vector2:
        return 0.0

    dot = sum(
        vector1.get(k, 0.0) * vector2.get(k, 0.0)
        for k in vector1
    )
    norm1 = math.sqrt(sum(v * v for v in vector1.values()))
    norm2 = math.sqrt(sum(v * v for v in vector2.values()))

    if norm1 == 0.0 or norm2 == 0.0:
        return 0.0

    return max(0.0, min(1.0, dot / (norm1 * norm2)))


# Conservative semantic-match decision layer.
# Similarity remains a score; it is not, by itself, proof of item identity.
OBJECT_GROUPS = {
    "wallet": {"wallet"},
    "bag": {"bag", "backpack", "rucksack", "handbag", "purse"},
    "phone": {"phone", "mobile", "cellphone", "smartphone"},
    "notebook": {"notebook", "journal", "diary"},
    "laptop": {"laptop", "macbook", "computer"},
    "bottle": {"bottle", "flask", "waterbottle"},
    "chair": {"chair", "armchair"},
    # Wired earbuds, over-ear headphones, and headsets are one broad audio-item
    # family for candidate retrieval; identity still requires visual/attribute evidence.
    "audio_device": {"headphone", "headset", "earphone", "earbud", "earbuds", "headphones", "headsets", "earphones"},
    "key": {"key", "keys", "keychain", "keyring"},
}

GENERIC_TOKENS = {
    "item", "thing", "object", "lost", "found", "missing",
    "misplaced", "near", "close", "college", "entrance",
    "gate", "library", "building", "area", "place",
}

def _object_groups(tokens: List[str]) -> set:
    words = set(tokens)
    return {
        group
        for group, aliases in OBJECT_GROUPS.items()
        if words & aliases
    }

def _decide_match(text1: str, text2: str, result: dict) -> bool:
    tokens1 = result.get("tokens1", [])
    tokens2 = result.get("tokens2", [])

    if not tokens1 or not tokens2:
        return False

    # Reject when both descriptions name an object type but the types conflict.
    groups1 = _object_groups(tokens1)
    groups2 = _object_groups(tokens2)
    if groups1 and groups2 and groups1.isdisjoint(groups2):
        return False

    # Location-only or otherwise generic descriptions are insufficient evidence.
    meaningful1 = set(tokens1) - GENERIC_TOKENS
    meaningful2 = set(tokens2) - GENERIC_TOKENS
    if not meaningful1 or not meaningful2:
        return False

    # Require some non-generic descriptive evidence on both sides.
    shared = meaningful1 & meaningful2
    score = float(result.get("similarity", 0.0))
    overlap = float(result.get("token_overlap_percent", 0.0)) / 100.0

    # A strong semantic score may support paraphrases, but not a known conflict.
    return score >= 0.60 or (score >= 0.45 and overlap >= 0.30 and bool(shared))


def _tfidf_compare(text1: str, text2: str) -> dict:
    """Original lightweight fallback matcher."""
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

    similarity = max(
        0.0,
        min(1.0, (0.7 * cosine) + (0.3 * overlap)),
    )

    return {
        "model": "TraceMate NLP TF-IDF baseline",
        "method": "token normalization + TF-IDF cosine similarity",
        "similarity": round(similarity, 6),
        "similarity_percent": round(similarity * 100.0, 2),
        "token_overlap_percent": round(overlap * 100.0, 2),
        "tokens1": tokens1,
        "tokens2": tokens2,
        "match": False,
    }


def _token_overlap(text1: str, text2: str) -> tuple[List[str], List[str], float]:
    tokens1 = tokenize(text1)
    tokens2 = tokenize(text2)

    set1 = set(tokens1)
    set2 = set(tokens2)
    union = set1 | set2
    overlap = (len(set1 & set2) / len(union)) if union else 0.0

    return tokens1, tokens2, overlap


def _sbert_compare(text1: str, text2: str, model) -> dict:
    """Semantic similarity using Sentence-BERT embeddings."""
    tokens1, tokens2, overlap = _token_overlap(text1, text2)

    if not tokens1 or not tokens2:
        return {
            "model": f"SBERT {SBERT_MODEL_NAME}",
            "method": "sentence embeddings + cosine similarity",
            "similarity": 0.0,
            "similarity_percent": 0.0,
            "token_overlap_percent": round(overlap * 100.0, 2),
            "tokens1": tokens1,
            "tokens2": tokens2,
            "match": False,
        }

    # Encode the original descriptions so SBERT can use semantic context.
    embeddings = model.encode(
        [text1, text2],
        normalize_embeddings=True,
        convert_to_numpy=True,
    )

    # With normalized embeddings, their dot product is cosine similarity.
    score = float(embeddings[0] @ embeddings[1])
    score = max(0.0, min(1.0, score))

    return {
        "model": f"SBERT {SBERT_MODEL_NAME}",
        "method": "sentence embeddings + cosine similarity",
        "similarity": round(score, 6),
        "similarity_percent": round(score * 100.0, 2),
        "token_overlap_percent": round(overlap * 100.0, 2),
        "tokens1": tokens1,
        "tokens2": tokens2,
        "match": False,
    }


def compare_texts(text1: str, text2: str) -> dict:
    """
    Compare two lost/found descriptions.

    SBERT is preferred. If sentence-transformers or the model cannot be
    loaded, the original TF-IDF baseline is returned instead.
    """
    model = _load_sbert()

    if model is not None:
        result = _sbert_compare(text1, text2, model)
        result["match"] = _decide_match(text1, text2, result)
        result["backend"] = "sbert"
        result["fallback_used"] = False
        return result

    result = _tfidf_compare(text1, text2)
    result["match"] = _decide_match(text1, text2, result)
    result["backend"] = "tfidf_fallback"
    result["fallback_used"] = True
    if _SBERT_LOAD_ERROR:
        result["fallback_reason"] = _SBERT_LOAD_ERROR
    return result
