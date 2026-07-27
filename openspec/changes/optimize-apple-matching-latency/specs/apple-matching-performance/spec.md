## ADDED Requirements

### Requirement: Task-scoped Apple session
The system SHALL reuse one authenticated Apple browser context for all catalog
operations in a matching job and SHALL close that context when the job
finishes.

#### Scenario: Multi-track match
- **WHEN** a logged-in user matches a playlist containing multiple tracks
- **THEN** the system initializes one Apple API session for the job and performs
  all storefront, search, and ISRC operations through it

#### Scenario: Job failure
- **WHEN** a matching operation throws or an individual track fails
- **THEN** the system closes the task-scoped Apple API session

### Requirement: Bounded rate-aware execution
The system SHALL process independent tracks with bounded concurrency and SHALL
pace Apple request starts through one job-level scheduler.

#### Scenario: Large playlist
- **WHEN** a playlist contains more tracks than the configured worker limit
- **THEN** no more than the configured number of track operations execute
  concurrently and results retain source-playlist order

#### Scenario: Apple rate limit
- **WHEN** Apple returns a rate-limit or transient server response
- **THEN** the system waits according to `Retry-After` or bounded backoff and
  retries no more than the configured retry limit

#### Scenario: Configured execution policy
- **WHEN** a user starts or retries a match
- **THEN** track concurrency, request interval, request timeout, attempt count,
  retry delay, and artwork timeout use the values saved in Matching settings

#### Scenario: Random request pause enabled
- **WHEN** random request pauses are enabled with a minimum and maximum value
- **THEN** each request after the first waits the fixed interval plus a sampled
  pause inside that range

#### Scenario: Random request pause disabled
- **WHEN** random request pauses are disabled
- **THEN** request scheduling adds no random delay beyond fixed pacing and
  retry requirements

### Requirement: Configurable matching performance
The system SHALL expose bounded Apple matching performance controls in both
English and Chinese and SHALL validate submitted values before persistence.

#### Scenario: Existing preferences
- **WHEN** a stored preferences document predates the performance controls
- **THEN** the server supplies valid values for every new control

#### Scenario: Invalid performance value
- **WHEN** a submitted performance value has the wrong type or is outside its
  supported range
- **THEN** the server returns a validation error and leaves the current
  preferences unchanged

#### Scenario: Reversed random range
- **WHEN** a random-pause minimum is greater than its maximum
- **THEN** the server returns a validation error and leaves the current
  preferences unchanged

### Requirement: Bounded external operations
The system MUST apply explicit timeouts to Apple catalog requests and artwork
downloads.

#### Scenario: Stalled catalog request
- **WHEN** an Apple catalog request exceeds its timeout
- **THEN** the system treats it as a transient failure, applies the bounded
  retry policy, and eventually returns a track-level failure if retries are
  exhausted

#### Scenario: Stalled artwork download
- **WHEN** artwork cannot be downloaded before its timeout
- **THEN** cover tie-breaking stops waiting for that artwork and preserves the
  existing ambiguous decision

### Requirement: Lazy cross-store bridging
The system SHALL resolve an account-store ID only for a selected candidate and
SHALL reuse an existing `addableId`.

#### Scenario: Automatic native-store match
- **WHEN** matching automatically selects a candidate from a different
  storefront and the candidate has an ISRC
- **THEN** the system performs one account-store ISRC lookup for that selected
  candidate

#### Scenario: Ambiguous native-store match
- **WHEN** native-store search produces candidates but no candidate is selected
- **THEN** the system performs no account-store ISRC lookup for those candidates

#### Scenario: Manual native-store selection
- **WHEN** a user manually selects an unresolved native-store candidate and
  creates a playlist
- **THEN** the system resolves that selected candidate before collecting final
  playlist track IDs

### Requirement: Reusable artwork comparison
The system SHALL reuse artwork-processing resources and artwork features within
one matching job.

#### Scenario: Repeated artwork URL
- **WHEN** multiple comparisons reference the same artwork URL in one job
- **THEN** the system downloads and computes features for that URL at most once

#### Scenario: No cover tie
- **WHEN** metadata scoring resolves a track without cover tie-breaking
- **THEN** the system does not initialize artwork browser resources for that
  track

### Requirement: Matching latency diagnostics
The system SHALL emit structured server log records for Apple request attempts,
matching stages, and the completed job summary.

#### Scenario: Completed job
- **WHEN** a matching job completes
- **THEN** the logs contain total duration, processed track count, Apple request
  count, retry count, and per-stage duration records

#### Scenario: Request failure
- **WHEN** an Apple request fails
- **THEN** its log record includes the operation, attempt, duration, and
  available HTTP status without exposing authentication tokens

### Requirement: Behavioral compatibility
The optimized matcher SHALL preserve scoring decisions, report ordering, retry
semantics, and progress totals.

#### Scenario: Out-of-order worker completion
- **WHEN** a later source track finishes before an earlier source track
- **THEN** the final report still places both results in source-playlist order

#### Scenario: Existing match cases
- **WHEN** existing deterministic matcher fixtures are processed
- **THEN** their matched, ambiguous, and not-found decisions remain unchanged
