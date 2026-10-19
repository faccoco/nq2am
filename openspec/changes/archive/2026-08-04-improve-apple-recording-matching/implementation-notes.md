# Implementation notes

## Calibration

Scoring version 2 uses the checked-in defaults below as one versioned set:

- Automatic threshold: `0.86`
- Review threshold: `0.62`
- Recording-group margin: `0.08`
- Identity confidence reserves `0.12` for positive album or artwork evidence.

Run `pnpm run replay:apple` to reproduce the report in `calibration-report.json`. The replay combines the 40 confirmed release selections in `real-songs-same-recording.json` with seven curated recording-pattern cases. Retrieval recall, classifier metrics, category errors, and threshold sweeps are reported independently.

## Compatibility

Unversioned matching preferences reset only the incompatible threshold and margin controls. Valid storefront, pacing, concurrency, version preference, explicit preference, and duration preference values are retained. A settings update with any scoring version other than `2` fails before persistence.

Persisted `not_found` rows are migrated only when their reason clearly identifies a request failure or a below-threshold candidate decision. Manual no-match rows and unknown reasons remain unchanged.

## Data coverage limitations

- No eligible persisted manual no-match corpus is checked into this repository. Such rows are therefore excluded rather than inferred as negative labels.
- Saved candidate fixtures validate classifier behavior and recall-at-K calculation, but do not claim live Apple storefront recall. The bounded query-cascade behavior and per-query contribution are covered with deterministic API-session tests.
- Alias suggestions can be extracted from manual confirmations, but runtime aliases remain limited to the reviewed version-controlled fixture.
