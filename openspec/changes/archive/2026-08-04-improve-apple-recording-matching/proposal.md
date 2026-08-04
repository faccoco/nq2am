## Why

The current Apple Music matcher combines single-query retrieval, release metadata scoring, and final classification into one threshold decision. This causes valid recordings to be missed when platforms use different artist credits, albums, or version suffixes, while duplicate releases can incorrectly create ambiguous results and legacy thresholds retain incompatible meaning after scoring changes.

## What Changes

- Add versioned matching preferences so persisted thresholds from an older score model are migrated to calibrated defaults instead of being reinterpreted on a new scale.
- Replace the single Apple catalog query with a bounded, deduplicated multi-query retrieval cascade and add replay metrics that report candidate recall at K independently from final match accuracy.
- Parse titles into base-title and version evidence, distinguish recording-changing versions from release-only labels, and compare artist credits asymmetrically so extra source-side Vocaloid, character, and featured credits do not unfairly reject a match.
- Group Apple candidates that represent the same recording before applying ambiguity rules, using ISRC when available and conservative metadata equivalence otherwise.
- Evaluate album and artwork evidence before the final decision thresholds; matching albums and covers may strengthen a plausible candidate, while differing release artwork or album names do not by themselves reject the same recording.
- Replace the single acceptance threshold with calibrated review and automatic-match thresholds, preserving an ambiguous review band and requiring a decisive recording-group margin for automatic selection.
- Add an offline calibration and replay workflow based on confirmed manual selections, manually rejected candidates, and maintained fixtures; report retrieval recall separately from classifier precision, recall, and ambiguity rate.
- Distinguish successful searches that retrieved no plausible candidates from searches that retrieved candidates but rejected every recording group, including separate report counts, review filters, retry scopes, persistence behavior, and localized UI labels.

## Capabilities

### New Capabilities

- `apple-candidate-retrieval`: Defines bounded multi-query Apple catalog retrieval, candidate deduplication, early stopping, query diagnostics, and recall-at-K replay metrics.
- `apple-recording-resolution`: Defines versioned scoring preferences, recording-aware title/artist/version evidence, recording grouping, album and artwork evidence, dual-threshold decisions, calibration, and result diagnostics.

### Modified Capabilities

- `apple-match-request-failure-handling`: Changes semantic negative results so a successful zero-candidate retrieval remains `not_found`, while retrieved candidates rejected by the recording decision model use a distinct result classification and review/retry path without being confused with `request_failed`.

## Impact

- Matching preferences, validation, persistence migration, settings UI, and English/Chinese explanations.
- Apple catalog query orchestration, candidate metadata, scoring, recording grouping, artwork comparison, result reasons, and retry behavior.
- Match report types and compatibility normalization, server filters/routes, summary counts, review tabs, and localized status labels.
- Test fixtures and replay tooling for retrieval recall, recording-level classification, threshold calibration, historical regression comparisons, and hard-negative version cases.
- Apple request volume may increase only for unresolved tracks; the existing concurrency, pacing, retry, and request-failure policies remain in force.
- No runtime dependency on a remote ML service or pretrained model is introduced.
