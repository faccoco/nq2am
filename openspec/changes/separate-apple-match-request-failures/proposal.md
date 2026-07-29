## Why

Apple catalog timeouts, rate limits, and transport failures are currently stored as `not_found`, which makes unavailable songs indistinguishable from requests that never completed successfully. Large matching jobs therefore report misleading Not found totals and make it difficult to retry only transient failures.

## What Changes

- Add a distinct `request_failed` match result for Apple catalog operations that exhaust their configured retry policy because of timeouts, HTTP failures, transport errors, or closed request contexts.
- Exclude request failures from the Not found count and list, and expose a dedicated Request failed tab with its own count in the matching review UI.
- Allow users to retry request-failed tracks independently; a successful retry replaces the failure with the resulting matched, ambiguous, or not-found decision.
- Reclassify recognizable request failures in previously persisted reports when they are loaded, while preserving their original diagnostic reason.
- Keep the default matching concurrency at `3`.
- Enable randomized request pauses by default for new or incomplete preferences, using the existing configurable minimum and maximum pause controls. An explicitly saved disabled setting remains disabled.
- Keep request pacing bounded and user-configurable without adding adaptive concurrency, sliding-window rate control, or automatic tuning.

## Capabilities

### New Capabilities

- `apple-match-request-failure-handling`: Defines request-failure classification, persistence compatibility, review filtering, retry behavior, counts, and default randomized request pacing.

### Modified Capabilities

None.

## Impact

- Match result types and persisted report compatibility in `src/types.ts`, matcher execution, filters, and server routes.
- Matching-page summary counts, tabs, retry scopes, API types, and English/Chinese translations.
- Matching preference defaults and server-side preference migration for randomized pauses.
- Unit and route coverage for timeout/HTTP failure classification, legacy report normalization, retries, filtering, and preference defaults.
- No matching-score, threshold, search-query, artwork-comparison, or playlist-creation behavior changes.
