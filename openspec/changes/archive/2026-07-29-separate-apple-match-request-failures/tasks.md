## 1. Result Model And Failure Classification

- [x] 1.1 Extend core and web match-status types with `request_failed` and add optional structured request-failure diagnostics without changing candidate or selection fields.
- [x] 1.2 Expose a stable Apple request-error classification path for timeout, rate-limit, HTTP, network, session, and closed-context failures after retries are exhausted.
- [x] 1.3 Update per-track and session-initialization error handling to emit `request_failed`, while preserving semantic `not_found` results and best-effort artwork behavior.
- [x] 1.4 Add matcher and API-session tests for timeout, HTTP 429, network/context closure, successful zero-result search, below-threshold candidates, and artwork timeout behavior.

## 2. Persisted Report Compatibility

- [x] 2.1 Implement an idempotent legacy-report normalizer that reclassifies only confidently recognizable request-error reasons and preserves the original reason.
- [x] 2.2 Apply report normalization during task-store loading and persist the task store once when a legacy report changes.
- [x] 2.3 Add persistence tests covering legacy 429, timeout, closed-context, zero-result, below-threshold, manual no-match, and unknown reasons.

## 3. Filtering And Retry API

- [x] 3.1 Add shared Request failed filtering plus the `request_failed` review-tab and retry-scope types.
- [x] 3.2 Accept the Request failed scope in the retry route and retry only current `request_failed` indices, while leaving the compatibility retry-not-found endpoint unchanged.
- [x] 3.3 Verify retry replacement transitions from Request failed to Matched, Ambiguous, Not found, or Request failed and preserves selected-scope index deduplication.
- [x] 3.4 Extend filter and route tests for Request failed counts, scope validation, empty scopes, compatibility behavior, and retry progress totals.

## 4. Matching Review UI

- [x] 4.1 Add a Request failed summary statistic and sticky review tab, keeping Not found counts and lists semantically separate.
- [x] 4.2 Render request-failed tracks in the dedicated tab and All view with source metadata, distinct styling, and their diagnostic reason but no misleading candidate controls.
- [x] 4.3 Add Request failed to the retry menu, synchronize the retry scope when its tab is opened, and retain cross-tab Selected retry behavior.
- [x] 4.4 Add complete English and Chinese translations for the new status, statistic, tab, empty state, diagnostic fallback, and retry scope.

## 5. Randomized Pacing Defaults

- [x] 5.1 Change `appleRandomPauseEnabled` to default to `true` while keeping `matchConcurrency` at `3` and retaining the existing interval and random-range defaults.
- [x] 5.2 Verify preference loading supplies enabled random pauses only when the field is absent and preserves an explicitly stored `false`.
- [x] 5.3 Add preference and scheduler coverage for new, incomplete, enabled, disabled, and invalid random-pause configurations.
- [x] 5.4 Add a regression test proving rate-limit handling does not automatically mutate concurrency, fixed interval, or random-pause settings.

## 6. Verification

- [x] 6.1 Run `pnpm test` and fix regressions within this change's scope.
- [x] 6.2 Run `pnpm run lint` and `pnpm run build:web`.
- [x] 6.3 Manually verify bilingual Request failed counts, sticky-tab navigation, isolated retries, legacy-report migration, and Matching settings with a representative saved report.
