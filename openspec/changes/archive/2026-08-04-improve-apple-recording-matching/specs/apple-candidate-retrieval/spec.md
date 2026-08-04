## ADDED Requirements

### Requirement: Bounded multi-query candidate retrieval
The system SHALL retrieve Apple Music candidates through a bounded query cascade that tolerates platform differences without issuing every query for every track.

#### Scenario: Primary query finds a deterministic recording match
- **WHEN** the original title and primary-artist query returns a candidate satisfying the deterministic recording identity rules
- **THEN** the system may stop the cascade and SHALL retain the successful query and candidate diagnostics

#### Scenario: Primary query does not retrieve a plausible recording
- **WHEN** the original title and primary-artist query returns no plausible recording candidate
- **THEN** the system continues through normalized base-title and alternate metadata query variants until a decisive recording is found or the configured query budget is exhausted

#### Scenario: Additional source artist retrieves the recording
- **WHEN** the source platform credits multiple meaningful artists and the primary-artist query misses the recording
- **THEN** the cascade searches bounded base-title variants with additional meaningful artists

#### Scenario: Album-assisted query retrieves the recording
- **WHEN** title-and-artist variants do not retrieve a plausible recording and the source album is available
- **THEN** the cascade includes a bounded base-title and album query

#### Scenario: Storefront fallback is required
- **WHEN** native-storefront search completes without a plausible recording and the account storefront is different
- **THEN** the system may continue the remaining bounded retrieval variants in the account storefront without duplicating equivalent requests

### Requirement: Retrieval candidate union and deduplication
The system SHALL combine candidates from every completed retrieval pass without allowing duplicate search results to distort recording-level decisions.

#### Scenario: Same Apple song appears in multiple query results
- **WHEN** multiple query variants return the same storefront and Apple song identifier
- **THEN** the system retains one candidate and records every retrieval source associated with it

#### Scenario: Same recording appears on multiple releases
- **WHEN** retrieval returns different Apple song identifiers that may represent the same recording on different releases
- **THEN** the system retains the release candidates for recording grouping rather than discarding them as duplicate song identifiers

#### Scenario: Query order differs
- **WHEN** the same candidate set is returned in a different query-response order
- **THEN** candidate identity and final recording evaluation remain deterministic

### Requirement: Retrieval pacing and failure isolation
The retrieval cascade SHALL use the existing Apple request concurrency, pacing, timeout, and retry policy and SHALL preserve request-failure classification.

#### Scenario: Additional retrieval passes are needed
- **WHEN** a track advances beyond its primary query
- **THEN** each additional Apple request uses the configured scheduler, random pause, timeout, and bounded retry behavior

#### Scenario: One optional fallback query fails after earlier searches succeeded
- **WHEN** an optional later query exhausts its request attempts after earlier queries returned candidates
- **THEN** the system records the failed query diagnostic and continues evaluating the successfully retrieved candidates

#### Scenario: No required retrieval pass completes
- **WHEN** request failures prevent the matcher from obtaining a usable candidate response for the track
- **THEN** the track is classified as `request_failed` under the request-failure policy

### Requirement: Retrieval outcome diagnostics
The system SHALL report retrieval outcomes separately from recording-decision outcomes.

#### Scenario: Successful searches return no candidates
- **WHEN** all completed query variants return no Apple song candidates
- **THEN** the result is `not_found` and its reason identifies the attempted query variants and storefronts

#### Scenario: Candidates are retrieved
- **WHEN** at least one candidate is retrieved from a successful query
- **THEN** the result diagnostics record the unique candidate count and retrieval sources before recording evaluation

#### Scenario: Candidate is rejected later
- **WHEN** candidates were retrieved but no recording group satisfies the review decision rules
- **THEN** retrieval is reported as successful and the final result is not described as a recall miss

### Requirement: Retrieval replay metrics
The system SHALL provide an offline replay report that measures candidate retrieval independently from recording classification.

#### Scenario: Labeled recording is retrieved
- **WHEN** a replay item has a known correct Apple recording and the retrieval cascade returns it at rank K or earlier
- **THEN** the replay report counts the item toward recall at K

#### Scenario: Labeled recording is not retrieved
- **WHEN** no candidate equivalent to the labeled recording appears within the retained candidates
- **THEN** the replay report counts a retrieval miss regardless of how the scorer ranks unrelated candidates

#### Scenario: Replay report is generated
- **WHEN** the maintained fixtures and eligible historical confirmations are replayed
- **THEN** the report includes recall at configured K values, per-query contribution, request count, and unresolved retrieval cases
