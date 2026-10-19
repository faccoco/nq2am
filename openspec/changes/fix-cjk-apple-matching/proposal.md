## Why

QQ and NetEase titles carry Chinese version and soundtrack suffixes that Apple search does not understand, while the v2 parser treats any `mix` token as a remix and skips JP/account fallback as soon as a CN result looks merely plausible. Correct recordings never enter the candidate set, Extended Mix is hard-rejected, and 伴奏/DJ版 can auto-match the studio vocal. Threshold retuning cannot fix missing retrieval or missing facets.

## What Changes

- Parse Chinese recording, structural, and release suffixes (伴奏, 翻唱, 现场, DJ版, 完整版, 主题曲/片头/片尾/插曲, and film/TV/anime parentheticals) so they are stripped from the base title and scored with the existing version rules.
- Stop treating a bare `mix` as a recording-changing remix; `Extended Mix` remains structural.
- Issue the first Apple search with the cleaned base title plus primary artist. Dirty original titles may run later and must not occupy the required first pass.
- Skip account-storefront fallback only when a native candidate already satisfies deterministic identity, not when it merely crosses the review threshold.
- Implement P1 in this change: simplified/traditional folding; catalog-dump artist aliases from MusicBrainz + VocaDB (not a pinyin/romaji converter), with a Matching-settings control to download the local index; JP storefront detection for kanji-only titles; and looser no-ISRC grouping.
- Do not train a model, change scoring version, or retune `threshold` / `reviewThreshold` / `ambiguousGap`.

## Capabilities

### New Capabilities

- `artist-alias-catalog`: local MusicBrainz/VocaDB artist-name index, compiled on an explicit Matching-settings refresh, used as alias evidence at match time.

### Modified Capabilities

- `apple-candidate-retrieval`: First-pass query terms use the cleaned base title; account-store fallback is skipped only for deterministic native identity. P1 adds native JP search for kanji-only Japanese titles instead of QQ/NetEase + Han → CN only.
- `apple-recording-resolution`: Chinese facets and soundtrack parentheticals participate in parsing; remix detection no longer matches a bare `mix`. P1 adds script folding, catalog-backed artist aliases, and a wider no-ISRC grouping window.

## Impact

- `src/apple/recordingMetadata.ts` facet rules and title stripping.
- `src/apple/retrieval.ts` query variant order and terms.
- `src/apple/matcher.ts` fallback early-stop condition.
- Parser, retrieval, and recording-pattern tests plus `pnpm run replay:apple`.
- Matching settings refresh control, local alias-index file, and English/Chinese copy. Apple request volume may rise only for tracks that never reach deterministic identity, and for Han-only QQ/NetEase titles that now also search JP.
