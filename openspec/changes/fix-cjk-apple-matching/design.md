## Context

Scoring version 2 already groups duplicate Apple releases and uses dual thresholds. Live QQ and NetEase matching still fails earlier: dirty titles are searched first, Chinese version words are invisible to the parser, a bare `mix` is treated as a remix, and a merely plausible CN hit skips JP/account fallback. Calibration replay never measured live storefront recall. This change keeps the v2 score model and repairs those P0 retrieval and parsing gaps.

## Goals / Non-Goals

**Goals:**

- Search Apple with a cleaned base title so soundtrack and Chinese version suffixes do not dominate the first catalog page.
- Treat Chinese 伴奏 / 翻唱 / 现场 / DJ版 as recording-changing evidence, 完整版 as structural, and 主题曲-style parentheticals as release-only title noise.
- Stop classifying `Extended Mix` as a remix.
- Continue native-to-account fallback until a deterministic recording identity exists.
- Keep scoring version 2, automatic/review/margin defaults, and explainable reasons.

**Non-Goals:**

- Training a ranker, embeddings, or any runtime model.
- Retuning `threshold`, `reviewThreshold`, or `ambiguousGap`.
- Runtime pinyin, Hepburn, or kana-to-romaji libraries as artist identity.
- Scraping Apple, QQ, or NetEase catalogs for name maps.
- Merging distinct catalog entities (circle vs vocalist) or treating CV-in-name credits as aliases.
- Audio fingerprinting or a local Apple catalog index.

## Decisions

### Strip shared metadata once, then search that base title

`parseRecordingMetadata` remains the single source of `baseTitle` and facets. Query planning uses that base title for the required first pass (`original_primary_artist` means cleaned identity plus primary artist). The raw source string is only a later optional variant when it still contains tokens that are not stripped metadata. Searching the dirty original first was rejected because Apple's 15-hit page fills with unrelated soundtrack or cover results before the cleaned variant runs.

### Map Chinese suffixes onto existing facet categories

Do not invent a parallel Chinese scorer. 伴奏 maps to `instrumental`, 翻唱 to `cover`, 现场/演唱会 to `live`, DJ版 to `remix`, 完整版 to `full`, and 主题曲/片头曲/片尾曲/插曲 plus 电影/电视剧/动画《…》 segments to release-only labels. Existing incompatibility caps then apply. A separate Chinese-only similarity path was rejected because version hard-negatives must stay discrete.

### Match remix, not mix

The remix rule matches `remix` / `リミックス` only. Structural rules already cover `extended mix`. Matching `(?:re)?mix` incorrectly hard-rejects originals against Extended Mix at confidence 0.35.

### Skip storefront fallback only for deterministic identity

`hasPlausibleRecording` (review threshold 0.62) is enough for a CN cover or same-title collision to block JP/account search. Fallback now skips only when `hasDeterministicRecording` is true. In-native early stop on deterministic identity is unchanged. Extra requests are bounded by the existing 8-pass budget and job query cache.

### Defer P1 identity work, and source aliases from catalog dumps

P1 still ships after P0 so retrieval regressions stay separable from identity regressions. It needs its own labeled replay (まらしぃ/marasy, 高桥/高橋, 炎). The four P1 pieces are specified in this change:

1. Fold simplified/traditional Han before title and artist comparison (OpenCC-style mapping). This is glyph identity, not an artist database.
2. Treat Apple and source names as the same artist when they share a bundled reviewed alias group or a locally compiled catalog group. Catalog groups come from licensed dumps — MusicBrainz artist aliases (CC0) for general artists, VocaDB names (CC BY 4.0) for Vocaloid, UtaiteDB for utaite, and TouhouDB for Touhou, all same-schema family dumps. Auto-import only localized artist names (Japanese, romaji, English). Search hints and legal names stay out. Matching never downloads dumps mid-job; the user refreshes the local index from Matching settings.
3. Choose JP as a native storefront for kanji-only Japanese titles instead of mapping every QQ/NetEase Han string to CN.
4. When ISRC is missing and version evidence agrees, widen the no-ISRC grouping duration window from about 4s to 8–12s so duplicate releases do not consume the 0.08 margin.

Rejected as the P1 alias mechanism: mechanical converters (`wanakana`, pinyin, kuromoji readings). They do not produce `まらしぃ` = `marasy` or `ラマーズP` = `LamazeP`, and they cannot distinguish `紫咲ほたる` from `EastNewSound`. Distinct catalog entities remain distinct. Character credits of the form `角色(CV:声优)` are credit-slot parsing, not alias compilation, and stay out of P1.

### P1 aliases are a bundled floor plus a user-refreshed local index

Two layers, both read at match time:

- **Bundled reviewed aliases** in `artistAliases.ts` stay version-controlled high-precision pairs (初音ミク, 米津玄師). They work before any download.
- **Local catalog index** lives in app data. Matching settings expose a Download alias catalog control that downloads the licensed dumps, compiles filtered name groups (entity id + ja/romaji/en names), and atomically replaces that index. Dump bytes are cached under the app data `alias-dumps/` directory and resumed with HTTP Range on cancel or failure; a completed dump whose ETag is unchanged is not fetched again. Dumps download one source at a time, but each dump is split into fixed-size segments fetched over several connections at once, because the dump hosts throttle per TCP connection: one stream gets about 10 KB/s where six get about 75 KB/s. Segment requests bypass the global fetch pool (which funnels an origin onto a single keep-alive connection and would undo the parallelism) and carry no project-specific User-Agent, since these are plain file servers rather than the MusicBrainz web service. A segment refused with 503 or dropped mid-transfer is retried with backoff while the other segments keep going. MusicBrainz compilation streams the xz/tar file from disk. The UI shows the catalog download date, dump date when known, sources, failure state, a progress bar with size, speed, and remaining time while downloading, and a cancel button. A download in progress disables starting another download, keeps the previous index for any in-flight job, and on cancel or failure leaves the previous index in place.

Rejected: fetching dumps when a match starts; auto-refresh on a timer; writing dump groups into git; mechanical converters as identity; merging distinct catalog entities; treating `角色(CV:声优)` as an alias. Manual job confirmations remain diagnostic suggestions, never an automatic runtime write.

Safety of the unattended compile is the import filter, not a human reviewing every MusicBrainz artist. Only names that already belong to one catalog entity are grouped. Circle vs vocalist stay different entities and therefore different groups.

## Risks / Trade-offs

- [More Apple requests when CN returns a plausible cover] → Skip fallback only on deterministic identity; keep query budget and cache.
- [Over-stripping titles that legitimately contain 现场 or 主题曲 as the name] → Facet rules require those tokens as descriptors (often wrapped or suffixed), not as the entire title; a title that is only the facet word is already preserved by the parser.
- [DJ版 mapping to remix may be coarse] → Same hard incompatibility as English remix; better than auto-matching the studio vocal.
- [Cleaned first query may miss a catalog entry that only exists under the dirty title] → Optional later original-title variant still runs when tokens remain after stripping.
- [P1 dump refresh is large and can fail] → Refresh is explicit, not on match start; failed compile keeps the previous index; bundled aliases remain the floor.
- [P1 dump refresh is large and can fail] → Refresh is explicit, not on match start; failed compile keeps the previous index; bundled aliases remain the floor.

## Migration Plan

No persisted-report or preference migration. Existing reports keep their scoring version. Rollback reverts the parser, planner, and fallback condition; result JSON shape is unchanged.

## Open Questions

- None for P0. P1 still needs a labeled replay corpus before dump-derived aliases, script folding, and grouping are calibrated (まらしぃ/marasy, 高桥/高橋, 炎, and known circle-vs-vocalist negatives).
