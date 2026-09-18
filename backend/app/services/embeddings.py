"""Lightweight local embedding (no external embedding API needed for the demo).

Uses a deterministic hashed bag-of-words vector. This is intentionally simple —
documented in ARCHITECTURE.md as a place to swap in a real embedding model
(e.g. text-embedding-3-small or a local sentence-transformer) with more time.
"""

import hashlib
import math
import re
from collections import Counter

from app.config import get_settings

settings = get_settings()

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def embed(text: str, dim: int | None = None) -> list[float]:
    dim = dim or settings.embedding_dim
    tokens = _tokenize(text)
    if not tokens:
        return [0.0] * dim

    counts = Counter(tokens)
    vec = [0.0] * dim
    for token, count in counts.items():
        h = int(hashlib.md5(token.encode()).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if (h // dim) % 2 == 0 else -1.0
        vec[idx] += sign * (1.0 + math.log(count))

    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
