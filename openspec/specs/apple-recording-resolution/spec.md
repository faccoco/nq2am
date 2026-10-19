# apple-recording-resolution Specification

## Purpose
TBD - created by archiving change improve-apple-recording-matching. Update Purpose after archive.
## Requirements
### Requirement: Versioned matching preferences
The system SHALL associate persisted thresholds and scoring controls with a scoring-version identifier and SHALL NOT reinterpret unversioned legacy thresholds as thresholds for a different scoring model.

#### Scenario: New preferences are created
- **WHEN** no matching preferences have been stored
- **THEN** the system stores the current scoring version with its calibrated automatic-match threshold, review threshold, and recording-group margin

#### Scenario: Legacy preferences have no scoring version
- **WHEN** stored preferences contain the legacy `threshold` or `ambiguousGap` fields without a scoring version
- **THEN** the system migrates them to documented current-version defaults instead of copying the numeric values directly into the new decision thresholds

#### Scenario: Current-version preferences are loaded
- **WHEN** stored preferences contain the current scoring version and valid decision values
- **THEN** the system preserves the user-configured values

#### Scenario: Unknown future scoring version is submitted
- **WHEN** a settings update specifies a scoring version unsupported by the running server
- **THEN** the server rejects the update and does not modify persisted preferences

### Requirement: Recording-aware metadata parsing
The system SHALL parse source and Apple metadata into recording identity evidence rather than treating every title suffix and release field as equivalent text.

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

### Requirement: Asymmetric artist identity evidence
The system SHALL compare artist credits in a role-aware, asymmetric manner that tolerates additional source-side credits without accepting an unrelated primary performer.

#### Scenario: Source includes Vocaloid or character credit
- **WHEN** the source credits a primary creator plus a Vocaloid, character, or voice credit and Apple credits only the primary creator
- **THEN** the extra source credit has limited negative effect when the primary artist identity agrees

#### Scenario: Apple artist uses an alias or transliteration
- **WHEN** an Apple artist name matches a known normalized alias or transliteration of a source artist
- **THEN** the system treats the names as the same artist entity and records the alias evidence

#### Scenario: Manual confirmation establishes an alias
- **WHEN** a user-confirmed match provides a stable cross-platform artist-name pair
- **THEN** the pair is eligible for the local alias evidence set without changing historical results automatically

#### Scenario: Primary performers are unrelated
- **WHEN** no primary or alias-equivalent artist relationship exists between source and candidate
- **THEN** matching title or duration alone cannot produce an automatic recording match

### Requirement: Recording-group resolution
The system SHALL group release candidates that represent the same recording before comparing the best and second-best alternatives.

#### Scenario: Releases share ISRC
- **WHEN** multiple Apple song candidates share an ISRC and have compatible title, artist, version, and duration evidence
- **THEN** the system evaluates them as one recording group

#### Scenario: ISRC is unavailable
- **WHEN** candidates lack a usable ISRC but have equivalent base titles, compatible artist entities and versions, and sufficiently close durations
- **THEN** the system may group them using conservative metadata equivalence

#### Scenario: Duplicate releases have equal scores
- **WHEN** two release candidates in the same recording group have equal evidence scores
- **THEN** they do not create an ambiguous result against each other

#### Scenario: Same ISRC conflicts with recording evidence
- **WHEN** candidates share an ISRC but have materially incompatible version or duration evidence
- **THEN** the system does not merge them automatically and records the conflict for review diagnostics

### Requirement: Positive release evidence before final decision
The system SHALL evaluate album and artwork evidence for plausible recording groups before applying the final decision thresholds.

#### Scenario: Source and candidate album agree
- **WHEN** a plausible recording candidate has an exact or strong normalized album match
- **THEN** album evidence strengthens that recording group and may distinguish it from another plausible group

#### Scenario: Same recording appears on a different album
- **WHEN** title, artist, version, and duration evidence identify the same recording but the album differs
- **THEN** the album difference is neutral unless it supplies evidence of a materially different recording version

#### Scenario: Artwork strongly agrees
- **WHEN** a plausible near-threshold recording group has decisively more similar artwork than competing groups
- **THEN** artwork evidence may raise or select that group before the final threshold decision

#### Scenario: Artwork differs or cannot be compared
- **WHEN** release artwork differs, is missing, or comparison fails
- **THEN** the system does not reject an otherwise valid recording solely on that basis

#### Scenario: Candidate is clearly unrelated
- **WHEN** metadata evidence places a candidate below the plausible evidence band
- **THEN** the system does not spend an artwork comparison request on that candidate

### Requirement: Dual-threshold recording decision
The system SHALL classify recording groups with separate automatic-match and review thresholds plus a minimum margin between competing groups.

#### Scenario: One group is decisively above the automatic threshold
- **WHEN** the best recording group reaches the automatic-match threshold and exceeds the second-best group by the required margin
- **THEN** the result is `matched` and the best release within that group is selected

#### Scenario: Plausible group requires review
- **WHEN** the best recording group reaches the review threshold but does not satisfy the automatic threshold or required group margin
- **THEN** the result is `ambiguous` and retains the plausible release candidates grouped by recording

#### Scenario: Retrieved groups remain below review threshold
- **WHEN** candidates were retrieved but every recording group remains below the review threshold after all eligible metadata, album, and artwork evidence is evaluated
- **THEN** the result is `score_rejected` and retains the best diagnostic candidates

#### Scenario: No candidates are retrieved
- **WHEN** bounded successful retrieval completes without any candidates
- **THEN** the result is `not_found` rather than `score_rejected`

### Requirement: Explainable recording decisions
The system SHALL retain structured evidence and a human-readable reason for every recording decision.

#### Scenario: Automatic match is selected
- **WHEN** a recording group is selected automatically
- **THEN** the result explains its group confidence, runner-up confidence, margin, decisive evidence, release selection, and scoring version

#### Scenario: Result remains ambiguous
- **WHEN** plausible groups cannot be separated decisively
- **THEN** the result explains which evidence remained close or unavailable

#### Scenario: Candidates are score rejected
- **WHEN** all retrieved recording groups are below the review threshold
- **THEN** the result explains the strongest group's evidence and why it did not qualify for review

### Requirement: Historical calibration and regression evaluation
The system SHALL calibrate versioned decision defaults through an offline, reproducible evaluation of labeled historical and fixture data rather than runtime self-training.

#### Scenario: Calibration data is assembled
- **WHEN** eligible manual selections, manual no-match decisions, maintained fixtures, and version hard negatives are collected
- **THEN** the calibration dataset records provenance and excludes unlabeled outcomes from supervised metrics

#### Scenario: Candidate model is evaluated
- **WHEN** a scoring or threshold change is calibrated
- **THEN** the evaluation reports recording-level automatic precision, automatic recall, ambiguity rate, score-rejection rate, and errors by version and artist-credit category

#### Scenario: Retrieval and classification are compared
- **WHEN** evaluation completes
- **THEN** retrieval recall at K is reported separately from recording-classifier metrics

#### Scenario: New scoring version is adopted
- **WHEN** calibrated defaults satisfy the documented precision target and regression cases
- **THEN** the constants and scoring-version identifier are updated together with the reproducible evaluation output
