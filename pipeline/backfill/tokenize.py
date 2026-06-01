"""
Tokenize a Sanskrit IAST verse line into rough lexical tokens for gloss lookup.

This is intentionally simple — split on whitespace and pipe/danda marks, strip
trailing/leading punctuation. It does NOT do sandhi splitting (that requires
a real morphological analyzer like Vidyut). The output is fed to the lexicon
which only matches surface forms it knows.

Hyphens inside compounds are split into separate sub-tokens for matching, but
the original compound form is also emitted (so the lexicon can match either).
"""

from __future__ import annotations
import re
import unicodedata


def split_iast_line(line: str) -> list[str]:
    """Return ordered list of surface tokens from a verse line."""
    # Normalize
    s = unicodedata.normalize("NFC", line)
    # Strip metrical marks and danda
    s = s.replace("॥", " ").replace("।", " ").replace("|", " ").replace("/", " ")
    # Split on whitespace
    raw = re.split(r"\s+", s)
    tokens: list[str] = []
    for tok in raw:
        t = tok.strip()
        if not t:
            continue
        # strip leading/trailing punctuation but keep apostrophes (sandhi marker for elided a)
        t = re.sub(r"^[\.\,\;\:\!\?\(\)\[\]\"]+|[\.\,\;\:\!\?\(\)\[\]\"]+$", "", t)
        if not t:
            continue
        tokens.append(t)
    return tokens


def split_compound(tok: str) -> list[str]:
    """If a token has internal hyphens, return the sub-tokens. Else return [tok]."""
    if "-" in tok:
        parts = [p for p in tok.split("-") if p]
        if len(parts) > 1:
            return parts
    return [tok]
