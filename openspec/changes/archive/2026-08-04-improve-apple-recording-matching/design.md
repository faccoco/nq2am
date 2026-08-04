## Context

The current matcher performs one free-text Apple catalog search using the source title and first artist, scores each returned release independently, and applies a single threshold before most album and artwork tie-breakers. Artist credit similarity averages symmetric coverage, so a source with additional Vocaloid, character, or featured credits can lose enough score to be rejected even when title, album, duration, and artwork agree. Separate Apple releases of the same recording can then compete with each other and create a false ambiguous result.

Matching preferences are persisted without a score-model version. A threshold such as `0.85` therefore survives changes in score range and feature semantics even though it no longer represents the same confidence. Existing reports also use `not_found` both when search returned no candidates and when candidates were returned but rejected, while request transport failures are already represented separately as `request_failed`.

The implementation must remain local and explainable, retain the existing Apple request scheduler and failure policy, support persisted-report migration, and avoid requiring an external ML service.

## Goals / Non-Goals

**Goals:**

- Increase candidate recall for cross-platform title, artist-credit, album, storefront, and suffix differences without making every track issue every possible query.
- Resolve the identity of a recording before choosing among its Apple release entries.
- Tolerate source-side extra artist credits and known aliases while preventing title-only matches to unrelated performers.
- Treat albums and artwork as positive release evidence before the final decision without making release differences hard negatives.
- Introduce score-model versioning, dual thresholds, recording-group margins, structured explanations, and reproducible calibration metrics.
- Separate retrieval misses, score rejections, ambiguous recordings, request failures, and successful matches throughout persistence, API, UI, and retry flows.

**Non-Goals:**

- Audio fingerprinting, preview-audio downloading, or acoustic model inference.
- A hosted model, remote embedding service, or runtime model training.
- Automatically changing user thresholds based on live matching traffic.
- Adaptive Apple request concurrency or rate-control behavior.
- Treating different releases as different recordings solely because album names or artwork differ.

## Decisions

### Use a recording-first pipeline

The matcher will have explicit stages:

1. Build normalized source metadata and bounded query variants.
2. Retrieve and union Apple release candidates.
3. Parse candidate metadata into recording identity features.
4. Group candidates that represent the same recording.
5. Add eligible album and artwork evidence.
6. Classify recording groups with review and automatic thresholds.
7. Choose an addable Apple release from the winning recording group.

This ordering prevents a low preliminary weighted score from bypassing stronger album or artwork evidence and prevents duplicate releases from being treated as independent competing recordings.

Alternative considered: retain the current candidate-level score and add more tie-breakers. This leaves retrieval, threshold migration, and duplicate-release ambiguity coupled to the old failure mode, so it is rejected.

### Use a bounded sequential retrieval cascade

The query planner will produce normalized, deduplicated variants in this order:

1. Original title plus primary artist.
2. Base title plus primary artist when it differs from the first query.
3. Base title plus each additional meaningful source artist, within a fixed pass budget.
4. Base title plus source album when available.
5. Base title alone as the broadest fallback.

Native storefront remains the first search location when configured. Account-store fallback is used only when the native passes do not produce a plausible recording and the storefronts differ. Query strings are deduplicated by normalized storefront and term, and responses are cached for the job. Candidate entries are deduplicated by storefront and Apple song ID while retaining all query provenance.

The cascade stops early only for deterministic high-confidence identity, such as compatible ISRC-backed evidence or exact base title, primary artist, version, and duration evidence that meets versioned strict rules. Merely crossing the statistical automatic threshold after the first broad result page is not sufficient for early stopping because a later variant may retrieve a stronger competitor.

Alternative considered: issue all variants in parallel. That improves latency per track but multiplies Apple request volume, works against configured pacing, and increases throttling risk, so it is rejected.

### Parse metadata into identity and release facets

Title parsing will produce a normalized base title, featured credits, and categorized version facets:

- Recording-changing: live, remix, cover, instrumental, off vocal, karaoke, and explicit edit/remix forms.
- Structural: extended, long, radio edit, album version, full version, and generic `ver` forms.
- Release-only: remaster, anniversary, deluxe, single, and edition labels that do not normally identify a different recording.

Recording-changing disagreement is a hard or near-hard incompatibility. Release-only disagreement is neutral. Structural suffix disagreement is unresolved until duration and other metadata are considered; this handles a platform omitting `Extended Mix` while still rejecting a short edit when durations disagree.

String features will combine normalized exact equality, character n-gram similarity, Jaro-Winkler-style short-name similarity, and token similarity where tokenization is meaningful. CJK titles continue to rely on normalized characters and n-grams rather than whitespace tokenization.

Alternative considered: remove every parenthesized suffix before comparing titles. That would conflate live, remix, instrumental, and original recordings, so it is rejected.

### Compare artist identities asymmetrically

Artist credits will be split into normalized entities and compared using one-to-one best matches. Evidence will retain separate features for:

- Best primary-artist pair.
- Coverage of Apple candidate artists by source artists.
- Coverage of source artists by Apple candidate artists.
- Exact or approved alias/transliteration matches.

Candidate-side and primary-artist agreement receive greater importance. Extra source-side artists receive a smaller penalty because source services often include a Vocaloid, character, voice actor, or featured performer that Apple omits. A candidate with no primary or alias-equivalent artist relationship cannot become an automatic match from title and duration alone.

Manual confirmations may produce alias suggestions for offline calibration. Suggestions do not become trusted global aliases at runtime until represented in a reviewed, version-controlled alias fixture, avoiding self-reinforcing errors from one accidental manual selection.

Alternative considered: multilingual text embeddings. They can place related but distinct performers or versions near one another and do not supply recording-version guarantees; they also add model packaging and calibration complexity. They are not used in this change.

### Group by recording before ambiguity evaluation

Each candidate receives recording features and belongs to a `RecordingGroup`. Grouping uses:

1. Shared ISRC plus compatible title, version, artist, and duration sanity checks.
2. When ISRC is absent, conservative equivalence across base title, artist identity, version facets, and duration.

ISRC is strong evidence but not an unconditional merge key because catalog metadata can contain reused or incorrect identifiers. Metadata fallback thresholds are versioned with the score model. Group confidence is derived from the strongest identity candidate; duplicate releases do not accumulate score merely by appearing multiple times.

After a group wins, its release selector considers source-album similarity, artwork evidence, account-store addability, explicit/clean preference, and stable Apple ID order. This separates “which recording?” from “which release entry should be added?”.

Alternative considered: deduplicate by ISRC during retrieval. That would discard the release alternatives needed to choose the source album or the addable storefront entry, so retrieval retains them until grouping.

### Make album and artwork positive-only evidence

Album similarity contributes positive evidence when it agrees strongly. A different album is neutral unless its title or associated version metadata indicates a materially different recording. Artwork comparison is limited to plausible groups near the review or ambiguity boundary and uses the existing best-effort comparator. Strong artwork agreement may rescue or separate a plausible group; missing, different, or failed artwork never independently rejects it.

Evidence is applied before final decision thresholds. Clearly unrelated candidates do not trigger artwork requests, preserving latency and request behavior.

Alternative considered: make album a fixed weighted field for every candidate. That penalizes the same recording on singles, compilations, regional releases, and remastered releases, so it is rejected.

### Version the existing settings and add a review threshold

The canonical v2 preference shape keeps familiar compatibility names while changing their documented semantics:

- `scoringVersion`: score and decision model identifier.
- `threshold`: automatic recording-match threshold for the current version.
- `reviewThreshold`: minimum confidence for an `ambiguous` result.
- `ambiguousGap`: minimum best-group versus runner-up-group margin for automatic selection.

An unversioned stored preference is treated as legacy. Its old `threshold` and `ambiguousGap` values are not copied because the score distributions are incompatible; current calibrated defaults are supplied. Unrelated valid preferences such as pacing, storefront, explicit preference, and duration preference are preserved. Current-version values remain user-configurable and invalid or unknown versions are rejected without updating storage.

Keeping `threshold` and `ambiguousGap` avoids unnecessary API churn while `scoringVersion` prevents future semantic reuse. The Settings UI will explain that the first threshold controls automatic acceptance and the lower threshold controls entry into review.

Alternative considered: mathematically rescale old `0.85` values. The old and new models differ in features, gates, grouping, and evidence order, so no reliable linear conversion exists.

### Use four semantic outcomes after request execution

The semantic decision states are:

- `not_found`: bounded successful retrieval produced zero candidates.
- `score_rejected`: candidates were retrieved, but every recording group remained below `reviewThreshold`.
- `ambiguous`: at least one group reached `reviewThreshold`, but automatic threshold or margin requirements were not met.
- `matched`: one group met the automatic threshold and margin, or a strict deterministic identity rule selected it.

`request_failed` remains an execution outcome used when required retrieval could not complete. Optional later query or artwork failures are diagnostics and do not erase usable earlier evidence.

Reports, tabs, counts, retry scopes, exports, persistence, and translations will use these definitions. Legacy below-threshold reasons are migrated to `score_rejected` only when the stored reason is unambiguous; unknown legacy rows remain unchanged.

Alternative considered: retain `not_found` with an internal subtype. Separate statuses are chosen because users need independent counts, review lists, and retry scopes, and subtype-only filtering would continue to obscure the distinction in existing APIs.

### Calibrate offline and keep decisions explainable

The calibration corpus will combine:

- Maintained real-song and synthetic fixtures.
- User-confirmed selected candidates as positive recording-group labels.
- Non-selected candidates from confirmed selections as hard negatives when they represent different recordings.
- Manual no-match candidate sets as negatives.
- Curated live, remix, cover, instrumental, alternate-artist, duplicate-release, extra-credit, different-album, and omitted-suffix cases.

Unlabeled not-found rows are not treated as negative classifier labels because the correct recording may never have been retrieved. Replay first measures retrieval recall at K. Classification evaluation then runs only where a labeled recording decision exists and reports automatic precision, automatic recall, ambiguity rate, score-rejection rate, and category-specific regressions.

The first implementation retains an explainable versioned feature model and performs deterministic threshold and margin sweeps over replay data. It does not train online. A future offline logistic model can consume the same feature records without changing runtime result semantics, but is not required here. The default calibration target prioritizes automatic-match precision; the exact numeric defaults are accepted only with their versioned replay report.

Every candidate and group keeps structured evidence. Human-readable reasons are generated from that structure rather than being the sole source of truth for diagnostics or future migrations.

## Data Flow

```text
NormalizedTrack
  -> ParsedRecordingMetadata
  -> QueryPlan
  -> RetrievalTrace + AppleSong[]
  -> CandidateEvidence[]
  -> RecordingGroup[]
  -> release evidence (album/artwork)
  -> RecordingDecision
  -> AppleMatchResult + structured diagnostics
```

Persisted reports retain bounded candidate and group diagnostics, scoring version, retrieval outcome, and the final reason. The API and web type mirror will be updated together.

## Risks / Trade-offs

- [More search passes increase latency and Apple request volume] -> Use sequential escalation, query deduplication, job-level caching, strict query budgets, and existing pacing.
- [Broad title-only search returns many unrelated songs] -> Treat it as a final retrieval pass and require strong artist/version/duration evidence before review or automatic matching.
- [Alias learning can poison future matches] -> Generate suggestions from history but activate only reviewed, version-controlled aliases.
- [ISRC data can be wrong or reused] -> Require metadata sanity checks before grouping and expose conflicts in diagnostics.
- [Artwork comparison is slow or unavailable] -> Run it only for plausible groups and preserve metadata decisions when it fails.
- [Small historical datasets can overfit thresholds] -> Keep category-based fixtures, split related tracks together during evaluation, report sample counts, and prioritize precision over optimistic aggregate accuracy.
- [New statuses affect persisted reports and UI filters] -> Add narrow reason-based migration, preserve unknown legacy rows, and update server/web unions and retry scopes atomically.
- [Users may be surprised that legacy `0.85` is reset] -> Surface the scoring version and migrated calibrated values with localized settings explanations.

## Migration Plan

1. Add new result diagnostics and `score_rejected` support while retaining legacy report readers.
2. Add scoring-version preference migration and expose v2 settings without enabling the v2 matcher yet.
3. Build the replay corpus and record baseline metrics for the current matcher.
4. Implement retrieval planning, parsing, artist evidence, recording grouping, and pre-threshold release evidence behind scoring version 2.
5. Calibrate and commit v2 defaults with the replay report, then make v2 the default for new and migrated preferences.
6. Update UI counts, tabs, retry scopes, explanations, and persisted-report normalization.
7. Run the full test, lint, web build, and labeled replay suite before removing temporary compatibility instrumentation.

Rollback can select the previous scoring implementation for reports that retain a recognized older `scoringVersion`. New `score_rejected` results can be displayed as legacy `not_found` only in a rollback build that cannot read the new status; persisted source candidates and reasons remain intact for a later forward migration.

## Open Questions

- The exact v2 automatic threshold, review threshold, and recording-group margin remain outputs of the checked-in replay calibration rather than proposal-time constants.
- Historical reports must be audited to determine how many contain stable candidate IDs and manual labels suitable for replay; insufficient rows will be supplemented with curated fixtures rather than inferred labels.
