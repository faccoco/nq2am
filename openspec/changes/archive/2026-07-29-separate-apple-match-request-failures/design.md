## Context

The matcher currently converts every exception raised while processing a track into a `not_found` result. This includes Apple HTTP 429 responses, request timeouts, transport failures, and closed Playwright request contexts. The report and UI consequently present transient infrastructure failures as catalog misses, and the Not found retry scope mixes both categories.

Matching already has bounded worker concurrency, a shared request-start scheduler, configurable fixed and randomized pauses, request timeouts, and bounded retries. This change preserves that architecture. It separates failed execution from successful negative matching and changes the randomized-pause default without adding adaptive rate control.

## Goals / Non-Goals

**Goals:**

- Represent exhausted catalog-request failures with a distinct persisted result status.
- Keep request failures out of Not found counts and review lists.
- Give request failures their own bilingual review tab and retry scope.
- Upgrade confidently identifiable failures in existing persisted reports.
- Enable the existing bounded random pause by default.
- Keep default matching concurrency at three and retain all existing UI controls.

**Non-Goals:**

- Adaptive concurrency, sliding-window rate limiting, congestion control, or automatic preference changes.
- Changing matching scores, thresholds, search queries, storefront selection, or tie-breaking.
- Treating successful zero-result searches or low-scoring candidates as request failures.
- Treating best-effort artwork failures as catalog-request failures.
- Guaranteeing that randomized pauses eliminate Apple throttling.

## Decisions

### Add `request_failed` to the result model

`AppleMatchStatus` will gain `request_failed`. Any exception that prevents the required search/evaluation operation for one track from completing will produce that status. A session-initialization failure will produce `request_failed` for every affected track. Successful searches continue through the normal matching rules, so zero candidates and below-threshold candidates remain `not_found`.

The result will retain its human-readable `reason`. A small optional structured failure payload should record stable details needed by the UI and tests, such as failure kind, operation, HTTP status, and attempts when available. The UI must not parse display strings to classify new failures.

Keeping only `reason` was considered, but it would perpetuate string-based classification and make future retry/report behavior brittle. Adding a separate task-level failure was rejected because concurrent jobs can fail for some tracks while successfully matching others.

### Classify at the track execution boundary

Apple API errors will expose enough typed information for the matcher to serialize a request failure after retries are exhausted. The worker catch and session-creation catch will call one classification helper instead of constructing `not_found` directly. Unknown exceptions at this boundary are also execution failures, because the matcher did not complete a semantic decision.

Artwork comparison remains best-effort. Its timeout or decode failure continues to mean that no cover tie-breaker was available, not that Apple catalog search failed.

### Normalize legacy reports once when loading task state

A pure compatibility helper will inspect old `not_found` reasons for a deliberately narrow set of signatures: Apple API HTTP errors, request timeouts, Playwright target/request-context closure, and equivalent session transport failures. Confident matches become `request_failed`; zero-result, score-threshold, manual no-match, and unknown reasons remain unchanged.

Task loading will apply this helper and persist the migrated report once when any status changes. The original reason is preserved. A schema-version field was considered, but the existing unversioned task store and narrow idempotent migration do not justify introducing one for this change.

### Extend shared filtering and retry scopes

The shared match-filter module will add `getRequestFailedIndices`, the `request_failed` review tab, and the `request_failed` retry scope. The server route allowlist and web API types will use the same scope. Retrying produces a normal fresh result and replaces the old entry by source index, so a retry can move naturally to Matched, Ambiguous, Not found, or remain Request failed.

The compatibility `retry-not-found` endpoint will retain its name and semantics and will not include request failures. The existing Selected retry continues deduplicating indices across every tab.

### Add a dedicated review presentation

The matching page will compute Request failed independently, add a summary statistic and sticky tab, and provide localized status, empty-state, retry-scope, and diagnostic labels. Failure rows will emphasize the source track and error reason without candidate-selection controls, because catalog failure generally yields no trustworthy candidate set.

The All tab will continue showing every source track and will render `request_failed` with a distinct warning/error treatment. Not found will contain only successful negative matching decisions.

### Change only the random-pause fallback

`DEFAULT_MATCH_PREFERENCES.appleRandomPauseEnabled` will change from `false` to `true`. The existing minimum and maximum defaults remain unchanged, and `matchConcurrency` remains `3`. Preference validation already uses defaults only for missing fields, so an explicitly persisted `false` remains false while new or incomplete preferences receive true.

No scheduler algorithm changes are required. The fixed request interval plus one sample from the configured inclusive range remains the complete pacing rule outside existing bounded retry delays.

## Risks / Trade-offs

- **Legacy reason matching reclassifies an unrelated error** -> Use an allowlist of specific Apple/Playwright request signatures and leave unknown reasons untouched.
- **Random pauses still allow 429 responses on large jobs** -> Preserve request failures for targeted retries and keep pacing controls visible; adaptive behavior remains a separate future change.
- **A new status breaks exhaustive UI maps or counters** -> Update core and web unions, status styles, counters, filters, translations, and compile-time tests together.
- **Existing saved `false` does not adopt the new default** -> Preserve explicit user configuration; users can enable the setting in Matching settings.
- **Request failures have partial candidates** -> Retain diagnostics but do not expose incomplete candidates as a semantic Not found decision.

## Migration Plan

1. Extend result types and add pure request-failure classification and legacy-normalization helpers.
2. Route exhausted per-track and session-level request failures to `request_failed`.
3. Normalize persisted task reports during load and write migrated reports back once.
4. Extend retry scopes, server validation, and report filtering.
5. Add the Request failed statistic, sticky tab, result presentation, retry option, and bilingual text.
6. Change the random-pause default to enabled while retaining concurrency `3` and all existing bounds.
7. Verify new and legacy reports, retry transitions, preferences, lint, tests, and the web build.

Rollback can restore the previous status union and UI behavior. Persisted `request_failed` rows would need to be mapped back to `not_found` only for a rollback build that cannot read the new status.

## Open Questions

None for this scope. Adaptive pacing and score/search improvements remain separate changes.
