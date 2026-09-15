## 1. Parser facets

- [x] 1.1 Restrict the remix facet to `remix` / `リミックス` so a bare `mix` and Extended Mix are not recording-changing remixes.
- [x] 1.2 Add Chinese recording facets (伴奏, 翻唱, 现场/演唱会, DJ版), structural 完整版, and release-only 主题曲/片头/片尾/插曲 plus film/TV/anime parentheticals, and strip them from `baseTitle`.
- [x] 1.3 Add parser tests for those suffixes, Extended Mix vs remix, and soundtrack parentheticals.

## 2. Retrieval and fallback

- [x] 2.1 Make the required first query use cleaned base title plus primary artist; keep the dirty original only as a later optional variant when extra tokens remain.
- [x] 2.2 Skip account-storefront fallback only when a native candidate already has deterministic identity.
- [x] 2.3 Add planner and matcher tests that the first term omits 主题曲-style suffixes and that a merely plausible native hit still searches the account storefront.

## 3. Recording decisions and replay

- [x] 3.1 Add recording-pattern fixtures so 伴奏, DJ版, 翻唱, and 现场版 cannot automatically match the studio original, and original vs Extended Mix is not remix-rejected.
- [x] 3.2 Run `pnpm test` and `pnpm run replay:apple` without changing scoring-version defaults.

## 4. P1 identity, grouping, and catalog aliases

- [x] 4.1 Fold simplified/traditional Han in identity comparison (titles and artists) without requiring an alias group.
- [x] 4.2 Include JP native search for Han-only titles from QQ/NetEase instead of CN-only; keep kana→JP and hangul→KR.
- [x] 4.3 Widen no-ISRC grouping to 8–12s when version evidence agrees; do not merge 初音ミクの消失 with 初音ミクの暴走.
- [x] 4.4 Compile a local alias index from MusicBrainz, VocaDB, UtaiteDB, and TouhouDB dumps (ja/romaji/en names only; drop search hints and legal names); keep bundled aliases as the floor; keep distinct catalog entities distinct.
- [x] 4.5 Snapshot the alias index at match-job start so an in-flight job is unchanged by a later refresh; do not download dumps during matching.
- [x] 4.6 Add Matching-settings catalog download (EN/ZH): download, compile, atomically replace, show download date/sources/failure, progress bar, and cancel; disable download while running; failed or cancelled download keeps the previous index.
- [x] 4.7 Add P1 tests for 简繁, catalog aliases including まらしぃ/marasy, JP search for 炎, grouping window, converter-non-identity, and refresh failure/atomic replace.
- [x] 4.8 Resume interrupted dump downloads with HTTP Range, keep partial files on cancel, skip unchanged complete dumps, and stream MusicBrainz compile from disk.
- [x] 4.9 Download dumps sequentially, show speed and remaining time, and keep a single cancel control while a download is running.
- [x] 4.10 Fetch each dump as parallel range segments over separate connections, retry refused or truncated segments with backoff, and drop the project-specific User-Agent on dump requests.
- [x] 4.11 Merge the per-source groups that describe one artist when building the index, so a name covered by several dumps is not discarded as a naming conflict, while a name shared only by unrelated entities still is.
- [x] 4.12 Read a performer named inside a `角色(CV:声优)` credit as a credit for the recording, keeping the character itself out of the alias set.
- [x] 4.13 Group duplicate releases that carry their own ISRCs when title, primary artist, and duration agree tightly and no featured performer conflicts.
- [x] 4.14 Treat a version label carried only by the runner-up as separating evidence, so a plain recording is not reported as ambiguous against its own labelled variant.
