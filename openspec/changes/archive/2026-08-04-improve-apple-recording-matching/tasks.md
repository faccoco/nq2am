## 1. Baseline And Data Contracts

- [x] 1.1 Capture the current matcher's retrieval and decision results for maintained real-song fixtures and representative persisted reports as a versioned v1 regression baseline.
- [x] 1.2 Extend core, server, and web match types with `score_rejected`, structured retrieval diagnostics, recording-group evidence, scoring version, and bounded candidate provenance.
- [x] 1.3 Add `scoringVersion` and `reviewThreshold` to matching preferences, document `threshold` as the automatic-match threshold and `ambiguousGap` as the recording-group margin, and define calibrated v2 placeholder defaults for replay.
- [x] 1.4 Implement preference validation and migration so unversioned legacy thresholds reset to v2 calibrated defaults while unrelated valid preferences are preserved, and reject unsupported versions without changing storage.
- [x] 1.5 Update the English and Chinese Matching settings UI, tooltips, API mirrors, and preference tests for score versioning and dual-threshold behavior.

## 2. Recording Metadata And Artist Evidence

- [x] 2.1 Add a focused recording-metadata parser that extracts base title, featured credits, recording-changing facets, structural version facets, and release-only facets.
- [x] 2.2 Add parser tests for live, remix, cover, instrumental, off-vocal, karaoke, remaster, extended/long, radio edit, generic version, featured-credit, and multilingual punctuation cases.
- [x] 2.3 Add normalized character n-gram, short-name, and token similarity features suitable for Latin and CJK title and artist comparisons without a runtime model dependency.
- [x] 2.4 Replace symmetric artist-set scoring with structured primary-pair, candidate-coverage, source-coverage, and approved-alias evidence, including one-to-one artist pairing.
- [x] 2.5 Add a version-controlled artist alias fixture and offline alias-suggestion extraction from eligible manual confirmations without automatically trusting new suggestions at runtime.
- [x] 2.6 Add artist regression tests for extra Vocaloid/character/featured credits, aliases, transliterations, punctuation variants, unrelated primary performers, and reordered multi-artist credits.

## 3. Candidate Retrieval

- [x] 3.1 Implement a deterministic bounded query planner for original-title/primary-artist, base-title/primary-artist, additional-artist, album-assisted, and title-only variants.
- [x] 3.2 Add query-planner tests covering duplicate normalized variants, missing artists/albums, version suffix removal, multiple artists, storefront fallback, and maximum pass limits.
- [x] 3.3 Implement sequential Apple retrieval escalation with native-storefront preference, account-store fallback, job-level query caching, candidate union, and query provenance.
- [x] 3.4 Route every additional request through the existing concurrency, pacing, random-pause, timeout, and bounded retry scheduler without changing their configured defaults.
- [x] 3.5 Preserve usable earlier candidates when an optional later query fails, while returning `request_failed` when no required retrieval response can be evaluated.
- [x] 3.6 Add retrieval tests for early deterministic stopping, successful fallback passes, duplicate candidate responses, optional-pass failure, required retrieval failure, and stable ordering.

## 4. Recording Grouping And Release Evidence

- [x] 4.1 Create recording-group construction using ISRC with metadata sanity checks and conservative title/artist/version/duration fallback when ISRC is absent.
- [x] 4.2 Add grouping tests for duplicate single/album/compilation releases, conflicting reused ISRCs, missing ISRCs, remasters, live/remix alternatives, and duration variants.
- [x] 4.3 Refactor album scoring into positive release evidence so a strong album match can distinguish plausible groups while a different album remains neutral unless it signals another recording version.
- [x] 4.4 Run artwork comparison only for plausible near-threshold or competing groups and incorporate decisive artwork evidence before final classification without turning artwork failure or mismatch into a rejection.
- [x] 4.5 Implement deterministic release selection inside a winning recording group using album evidence, artwork evidence, addable storefront identity, explicit preference, and stable ID ordering.
- [x] 4.6 Add regression tests for PUPA-style duplicate releases, same recordings on different albums, decisive album/cover evidence, weak artwork margins, and failed artwork requests.

## 5. Decision Model And Result Semantics

- [x] 5.1 Build structured candidate and recording-group confidence from parsed metadata evidence with hard incompatibility rules for unwanted recording-changing versions.
- [x] 5.2 Apply album and eligible artwork evidence before the review threshold, automatic threshold, and recording-group margin are evaluated.
- [x] 5.3 Implement the four semantic outcomes: zero-candidate retrieval as `not_found`, below-review groups as `score_rejected`, review-band or close groups as `ambiguous`, and decisive groups as `matched`.
- [x] 5.4 Generate human-readable reasons from structured diagnostics, including scoring version, retrieval passes, group confidence, runner-up confidence, margin, decisive evidence, and rejection cause.
- [x] 5.5 Update report persistence and compatibility normalization so recognizable legacy below-threshold results become `score_rejected`, recognizable zero-result searches remain `not_found`, and unknown reasons remain unchanged.
- [x] 5.6 Extend filters, retry scopes, server routes, summary counts, review tabs, card states, and English/Chinese translations with a dedicated Score rejected workflow and cross-tab selection deduplication.
- [x] 5.7 Add route, persistence, filter, retry, and UI tests proving `not_found`, `score_rejected`, `ambiguous`, `matched`, and `request_failed` remain distinct.

## 6. Replay And Calibration

- [x] 6.1 Build an offline labeled replay corpus from maintained fixtures, eligible manual selections, manual no-match decisions, and curated hard negatives while recording provenance and excluding unlabeled negatives.
- [x] 6.2 Implement retrieval evaluation that reports recall at configured K values, per-query contribution, request count, and unresolved known matches independently from scoring.
- [x] 6.3 Implement recording-decision evaluation that reports automatic precision/recall, ambiguity rate, score-rejection rate, sample counts, and errors grouped by artist-credit and version category.
- [x] 6.4 Implement reproducible threshold and margin sweeps for the explainable v2 feature model, prioritizing the documented automatic-match precision target.
- [x] 6.5 Select and commit the v2 automatic threshold, review threshold, recording-group margin, feature constants, and scoring-version identifier together with the generated calibration report.
- [x] 6.6 Compare the v1 baseline and v2 replay for the known regressions involving extra artists, different albums, omitted suffixes, duplicate releases, and single-query retrieval misses.

## 7. Final Verification

- [x] 7.1 Add end-to-end fixtures covering the reported Alice in 冷凍庫, 炉心融解, hectopascal, IMPACT, World Vanquisher, PUPA, and Burn My Dread version patterns without depending on live Apple responses.
- [x] 7.2 Verify retrying each negative/review scope replaces results correctly and preserves configured request concurrency and randomized pacing.
- [x] 7.3 Run `pnpm test`, `pnpm run lint`, `pnpm run build:web`, and the labeled replay/calibration command, and record any residual data-coverage limitations in the change notes.
