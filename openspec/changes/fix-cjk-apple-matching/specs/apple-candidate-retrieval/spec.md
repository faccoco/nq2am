## MODIFIED Requirements

### Requirement: Bounded multi-query candidate retrieval
The system SHALL retrieve Apple Music candidates through a bounded query cascade that tolerates platform differences without issuing every query for every track. The required first pass SHALL use the cleaned recording base title plus primary artist rather than a source title that still contains stripped version or soundtrack metadata.

#### Scenario: Primary query finds a deterministic recording match
- **WHEN** the cleaned base-title and primary-artist query returns a candidate satisfying the deterministic recording identity rules
- **THEN** the system may stop the cascade and SHALL retain the successful query and candidate diagnostics

#### Scenario: Primary query does not retrieve a plausible recording
- **WHEN** the cleaned base-title and primary-artist query returns no plausible recording candidate
- **THEN** the system continues through normalized base-title and alternate metadata query variants until a decisive recording is found or the configured query budget is exhausted

#### Scenario: Additional source artist retrieves the recording
- **WHEN** the source platform credits multiple meaningful artists and the primary-artist query misses the recording
- **THEN** the cascade searches bounded base-title variants with additional meaningful artists

#### Scenario: Album-assisted query retrieves the recording
- **WHEN** title-and-artist variants do not retrieve a plausible recording and the source album is available
- **THEN** the cascade includes a bounded base-title and album query

#### Scenario: Storefront fallback is required
- **WHEN** native-storefront search completes without a deterministic recording identity and the account storefront is different
- **THEN** the system may continue the remaining bounded retrieval variants in the account storefront without duplicating equivalent requests

#### Scenario: Soundtrack or Chinese version suffix is present
- **WHEN** the source title includes a stripped soundtrack, 主题曲, 完整版, 伴奏, or similar metadata suffix
- **THEN** the required first query term uses the cleaned base title and primary artist and does not include that suffix

#### Scenario: Native result is only plausible
- **WHEN** native-storefront search retrieved a candidate that reaches the review threshold but does not satisfy deterministic identity
- **THEN** the system SHALL still issue remaining account-storefront fallback queries within the query budget

## ADDED Requirements

### Requirement: Native storefront for kanji-only Japanese titles
The system SHALL NOT select the CN storefront solely because the playlist provider is QQ or NetEase and the title contains Han. Kanji-only Japanese titles SHALL still be searched in JP within the existing query budget.

#### Scenario: Kanji-only Japanese title from a Chinese provider
- **WHEN** native search is enabled, the source is QQ or NetEase, and the title is a Japanese work written only in Han (for example 炎) without Hangul
- **THEN** the cascade includes JP native search rather than treating Han plus a Chinese provider as CN-only

#### Scenario: Kana still selects JP
- **WHEN** the track text contains hiragana or katakana
- **THEN** the native storefront remains JP

#### Scenario: Hangul still selects KR
- **WHEN** the track text contains Hangul
- **THEN** the native storefront remains KR
