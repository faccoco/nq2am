## Why
Named version suffixes such as `10th Anniversary ver.` and `まらおバンド ver.` were collapsed into one anonymous `generic_version` tag, so different recordings scored 1.00 vs 0.99 and blocked automatic selection. Decision thresholds were also user-tunable despite never being identified uniquely by the v2 corpus.

## What Changes
- Parse version wrappers into payload-bearing descriptors with a closed kind set and a four-state relation (`agree` / `structural_omit` / `named_omit` / `conflict`).
- Keep the existing identity weights; named conflicts are discrete (cap, no grouping, no runner-up, no deterministic identity).
- Show detected version labels on review candidates.
- Lock automatic / review / margin constants as scoring version 3 internals and remove the settings sliders.

## Capabilities
- `apple-recording-resolution`: Named version identity, grouping, and decision separation.
- `apple-matching-preferences` (via recording-resolution preference scenarios): v3 locked decision constants and v2 migration.

## Impact
- Affected code: `src/apple/recordingMetadata.ts`, `src/apple/versionSemantics.ts`, `src/apple/scoring.ts`, `src/apple/recordingResolution.ts`, `server/preferences.ts`, Matching settings UI, review candidate cards.
- Non-goals: retraining weights, runtime models, putting this into `fix-cjk-apple-matching`.
