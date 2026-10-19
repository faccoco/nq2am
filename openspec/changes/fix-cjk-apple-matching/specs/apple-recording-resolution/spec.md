## MODIFIED Requirements

### Requirement: Recording-aware metadata parsing
The system SHALL parse source and Apple metadata into recording identity evidence rather than treating every title suffix and release field as equivalent text. Parsing SHALL recognize English, Japanese, and common Chinese version and soundtrack labels, and SHALL NOT treat a bare `mix` token as a recording-changing remix.

#### Scenario: Release-only remaster label differs
- **WHEN** one title contains a remaster, anniversary, deluxe, or similar release-only label and the other metadata identifies the same recording
- **THEN** the release-only difference does not by itself make the recordings incompatible

#### Scenario: Recording-changing version differs
- **WHEN** only one title identifies a live, remix, cover, instrumental, off-vocal, karaoke, or materially edited recording
- **THEN** the system applies a strong incompatibility decision unless the source metadata independently requests that version

#### Scenario: Structural suffix is missing on one platform
- **WHEN** only one title includes an extended, long, radio-edit, album-version, or generic version suffix
- **THEN** the system evaluates base-title, artist, and duration evidence together rather than rejecting the candidate solely because the suffix is absent

#### Scenario: Featured credit appears in the title
- **WHEN** a title contains a featured or with credit
- **THEN** the system evaluates that credit as artist evidence and excludes it from base-title comparison

#### Scenario: Chinese recording-changing suffix differs
- **WHEN** only one title identifies 伴奏, 翻唱, 现场, 演唱会, or DJ版
- **THEN** the system applies the same strong incompatibility decision used for instrumental, cover, live, or remix unless the other title requests that version

#### Scenario: Extended Mix is structural
- **WHEN** one title is the original recording and the other is labeled Extended Mix without a remix token
- **THEN** the system treats the suffix as structural rather than as a remix incompatibility

#### Scenario: Chinese soundtrack parenthetical is stripped
- **WHEN** a title contains a 主题曲, 片头曲, 片尾曲, 插曲, 完整版, or film/TV/anime parenthetical
- **THEN** those labels are excluded from the base title used for identity comparison and search

#### Scenario: Simplified and traditional Han fold together
- **WHEN** source and candidate titles or artist names differ only by simplified versus traditional Han (for example 高桥 and 高橋)
- **THEN** identity comparison treats those strings as the same after folding and does not require an artist alias group

## ADDED Requirements

### Requirement: Catalog and bundled artist alias evidence
The system SHALL treat source and Apple artist names as the same entity when they belong to one bundled reviewed alias group or one locally compiled catalog alias group. Mechanical pinyin, Hepburn, or kana-to-romaji conversion SHALL NOT by itself establish alias equivalence.

#### Scenario: Apple artist uses an alias or transliteration
- **WHEN** an Apple artist name matches a known normalized alias or transliteration of a source artist in the bundled or local alias set
- **THEN** the system treats the names as the same artist entity and records the alias evidence

#### Scenario: Catalog dump names share one entity
- **WHEN** a compiled catalog group contains both `まらしぃ` and `marasy` as localized names of one MusicBrainz or VocaDB artist
- **THEN** matching treats those names as alias-equivalent after the group is present in the local index or bundled table

#### Scenario: Converter output is not identity
- **WHEN** two names are similar only after mechanical kana-to-romaji or pinyin conversion and no bundled or catalog group contains both names
- **THEN** the system SHALL NOT treat them as alias-equivalent solely because of that conversion

#### Scenario: Distinct catalog entities stay distinct
- **WHEN** MusicBrainz or VocaDB records a vocalist and a circle as different artists (for example 紫咲ほたる and EastNewSound)
- **THEN** the names SHALL NOT share an alias group

#### Scenario: Character CV credit is not an alias
- **WHEN** Apple credits a character name with a parenthetical CV and the source credits the voice actor
- **THEN** alias compilation SHALL NOT merge those strings, so the character never becomes an alias of the performer

#### Scenario: Performer named inside a character credit is a credit
- **WHEN** an Apple credit names a performer inside a `角色(CV:声优)` parenthetical and the source credits that performer directly
- **THEN** the performer SHALL be read as a credit for the recording and be eligible to establish the primary artist relationship

#### Scenario: Manual confirmation remains a suggestion
- **WHEN** a user-confirmed match provides a stable cross-platform artist-name pair
- **THEN** the pair is eligible as diagnostic alias-suggestion data and SHALL NOT be written into the runtime alias set automatically

### Requirement: No-ISRC grouping duration for duplicate releases
The system SHALL group release candidates that represent the same recording before comparing the best and second-best alternatives. When ISRC is unavailable and version evidence agrees, the duration window SHALL be wide enough to merge typical single versus album masters without merging different recordings.

#### Scenario: Duplicate releases lack ISRC but durations are close
- **WHEN** candidates lack a usable ISRC, share equivalent base titles, compatible artist entities and recording versions, and durations within 8 to 12 seconds
- **THEN** the system may evaluate them as one recording group

#### Scenario: Different recordings remain ungrouped
- **WHEN** candidates have similar titles but incompatible recording identity (for example 初音ミクの消失 versus 初音ミクの暴走)
- **THEN** the wider duration window SHALL NOT merge them

#### Scenario: Duplicate releases each carry their own ISRC
- **WHEN** two releases of one recording carry different ISRCs but agree on base title, primary artist, and duration within a tight window, and neither names a conflicting performer
- **THEN** differing ISRCs SHALL raise the grouping bar rather than rule grouping out, so the releases form one group instead of competing as rival recordings

#### Scenario: Performers disagree between separate ISRCs
- **WHEN** two candidates with different ISRCs each name a featured performer and those performers are not the same entity
- **THEN** the candidates SHALL stay separate recordings

### Requirement: Version labels separate a recording from its variants
A plain recording and a labelled variant of it routinely score within a fraction of each other, because a duration inside the tolerance window scores identically either way and the version weight is small. The system SHALL treat such a label as separating evidence rather than reporting the pair as ambiguous.

#### Scenario: Only the runner-up advertises an unrequested version
- **WHEN** the best recording group carries no version label beyond what the source title requests and the runner-up group advertises one (for example 空色デイズ versus 空色デイズ -北京語ver.-)
- **THEN** the label itself SHALL count as the separation between them and the thin score margin SHALL NOT force the track into review

#### Scenario: The labelled variant is the requested recording
- **WHEN** the labelled candidate is the one whose duration agrees with the source while the unlabelled candidates do not
- **THEN** the labelled candidate SHALL remain eligible to win, so the label alone never disqualifies a candidate
