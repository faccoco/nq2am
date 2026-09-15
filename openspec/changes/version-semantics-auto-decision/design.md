# Version semantics and locked v3 decisions

Named suffixes keep a kind + optional ordinal + folded payload. Comparison is exact on kind after a small synonym table; payloads are never compared by string similarity. Structural omissions (Extended Mix) stay duration-reconciled. Named omissions and named conflicts cannot auto-match or occupy the runner-up slot used for margin. Scoring version 3 always writes `0.86 / 0.62 / 0.08`; v2 files and stale PUT bodies keep non-decision settings and ignore the three score keys.
