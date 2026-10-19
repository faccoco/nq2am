## ADDED Requirements

### Requirement: Named version descriptors
The system SHALL parse `X ver.`, `X版`, `Xアレンジ`, and `#NVer.` wrappers into version descriptors that retain a kind, optional ordinal, and folded payload, and SHALL treat different named kinds as distinct recordings.

#### Scenario: Anniversary and band versions conflict
- **WHEN** the source title requests a 10th anniversary version and a candidate is labelled as a marao-band version
- **THEN** the candidates SHALL NOT share a recording group and the anniversary candidate MAY be selected automatically when it is otherwise decisive

#### Scenario: Cross-language anniversary labels agree
- **WHEN** one title uses `10th Anniversary ver.` and the other uses `10周年記念ver.`
- **THEN** the system treats them as the same named version kind

#### Scenario: Omitted Extended Mix remains compatible
- **WHEN** the source has no structural suffix and a candidate is labelled Extended Mix with agreeing duration
- **THEN** the labelled candidate remains eligible to win

#### Scenario: Unlabelled close duplicate is not deterministic
- **WHEN** the source requests a named version and the only candidate is an unlabelled title of similar duration
- **THEN** the system SHALL NOT auto-select it as a deterministic identity

### Requirement: Locked scoring version 3 decision constants
Scoring version 3 SHALL use fixed automatic, review, and margin constants. Stored v2 preferences and stale clients that still send the three keys SHALL keep non-decision settings and SHALL NOT change those constants.

#### Scenario: v2 preferences are loaded
- **WHEN** stored preferences contain scoring version 2
- **THEN** the server migrates them to scoring version 3 with the locked decision constants and preserves storefront, pacing, and concurrency

#### Scenario: Settings UI has no score sliders
- **WHEN** the user opens Matching settings
- **THEN** the automatic, review, and margin sliders are absent
