# Apple Match Request Failure Handling Specification

## Purpose

Define how Apple Music matching distinguishes request execution failures from semantic not-found results, exposes them for review and retry, migrates legacy reports, and applies bounded request pacing.

## Requirements

### Requirement: Distinct request-failure result
The system SHALL store a track-level Apple catalog failure as `request_failed` when a required request cannot complete after the configured retry policy, and SHALL NOT classify that result as `not_found`.

#### Scenario: Catalog request times out
- **WHEN** an Apple catalog search exhausts its configured attempts because each request times out
- **THEN** the track result is `request_failed` and retains a diagnostic reason describing the timeout

#### Scenario: Apple rate limit persists
- **WHEN** Apple continues returning HTTP 429 after the configured attempts are exhausted
- **THEN** the track result is `request_failed` and retains the HTTP status and diagnostic reason

#### Scenario: Transport or request context fails
- **WHEN** a network, request-context, or session failure prevents a track from being evaluated
- **THEN** the track result is `request_failed` rather than `not_found`

#### Scenario: Search succeeds without candidates
- **WHEN** Apple successfully answers the catalog search but returns no songs
- **THEN** the track result remains `not_found`

#### Scenario: Candidates fail the score threshold
- **WHEN** Apple returns candidates but none satisfies the matching decision rules
- **THEN** the track result remains `not_found`

### Requirement: Request-failure review
The matching report UI SHALL present request failures separately from not-found tracks in both English and Chinese.

#### Scenario: Report contains request failures
- **WHEN** a report contains one or more `request_failed` results
- **THEN** the summary displays a Request failed count and the sticky review navigation displays a Request failed tab with the same count

#### Scenario: User opens Request failed
- **WHEN** the user selects the Request failed tab
- **THEN** only `request_failed` tracks are listed with their source metadata and diagnostic reason

#### Scenario: User opens Not found
- **WHEN** the user selects the Not found tab
- **THEN** no `request_failed` track is included in that list or count

#### Scenario: User opens All
- **WHEN** the user selects the All tab
- **THEN** request-failed tracks remain visible with a distinct localized status

#### Scenario: No request failures
- **WHEN** a report contains no `request_failed` results
- **THEN** the Request failed count is zero and its tab provides an appropriate empty state

### Requirement: Request-failure retry
The system SHALL allow request-failed tracks to be retried as an independent retry scope.

#### Scenario: Retry request failures
- **WHEN** the user retries the Request failed scope
- **THEN** only results currently marked `request_failed` are submitted for matching

#### Scenario: Retry succeeds
- **WHEN** a request-failed track receives a successful Apple response during retry
- **THEN** its prior result is replaced by the new `matched`, `ambiguous`, or `not_found` result

#### Scenario: Retry fails again
- **WHEN** the required Apple request fails again after all configured attempts
- **THEN** the track remains `request_failed` with the latest diagnostic reason

#### Scenario: Selected retry across tabs
- **WHEN** the user selects request-failed tracks together with tracks from other tabs and retries the Selected scope
- **THEN** the system deduplicates the selected source indices and retries each selected track once

#### Scenario: Compatibility retry endpoint
- **WHEN** the legacy retry-not-found endpoint is used
- **THEN** it retries only `not_found` results and does not include `request_failed` results

### Requirement: Persisted report compatibility
The system SHALL normalize recognizable request failures from older persisted reports without changing semantic not-found decisions.

#### Scenario: Legacy rate-limit result
- **WHEN** a persisted `not_found` result contains a diagnostic reason that unambiguously identifies an Apple HTTP 429 failure
- **THEN** the result is loaded and persisted as `request_failed` while preserving the original reason

#### Scenario: Legacy timeout or closed-context result
- **WHEN** a persisted `not_found` result contains a diagnostic reason that unambiguously identifies a request timeout or closed request context
- **THEN** the result is loaded and persisted as `request_failed` while preserving the original reason

#### Scenario: Legacy semantic not-found result
- **WHEN** a persisted `not_found` result says that Apple returned no candidates or that the best score was below threshold
- **THEN** the result remains `not_found`

#### Scenario: Unknown legacy reason
- **WHEN** a persisted `not_found` result has a reason that cannot be confidently classified as a request failure
- **THEN** the system leaves the result unchanged

### Requirement: Randomized pacing default
The system SHALL enable the existing randomized Apple request pause by default while retaining user control over the setting and pause range.

#### Scenario: New preferences
- **WHEN** no stored matching preferences exist
- **THEN** randomized request pauses are enabled, matching concurrency defaults to `3`, and the existing default pause range is used

#### Scenario: Older preferences omit random pause
- **WHEN** stored matching preferences do not contain `appleRandomPauseEnabled`
- **THEN** the server supplies `true` and retains valid stored values for all other settings

#### Scenario: User explicitly disabled random pause
- **WHEN** stored matching preferences explicitly set `appleRandomPauseEnabled` to `false`
- **THEN** the server preserves `false`

#### Scenario: User configures random pause
- **WHEN** the user enables randomized pauses and saves a valid minimum and maximum in Settings
- **THEN** each request after the first uses the fixed configured interval plus a sampled pause within the configured inclusive range

#### Scenario: Default concurrency
- **WHEN** matching preferences are initialized without a stored concurrency value
- **THEN** matching concurrency is `3`

### Requirement: Fixed bounded pacing
The system SHALL continue using the configured fixed interval, randomized pause, timeout, attempt count, and bounded retry delay without automatic rate-control tuning.

#### Scenario: Matching encounters throttling
- **WHEN** Apple returns a rate-limit response
- **THEN** the existing bounded retry policy runs without automatically changing concurrency, request interval, or random-pause range

#### Scenario: Matching job completes
- **WHEN** a matching or retry job finishes
- **THEN** the configured pacing values remain unchanged
