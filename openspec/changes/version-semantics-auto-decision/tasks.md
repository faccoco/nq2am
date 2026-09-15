## 1. Version descriptors
- [x] 1.1 Parse named wrappers into kind/ordinal/payload descriptors with rule precedence.
- [x] 1.2 Compare versions with agree / structural_omit / named_omit / conflict.

## 2. Scoring, grouping, retrieval
- [x] 2.1 Cap named conflicts in the review band and clear automaticEligible.
- [x] 2.2 Do not group conflicting named versions; exclude ineligible groups from the margin runner-up.
- [x] 2.3 Restrict deterministic identity so retrieval cannot early-stop on a conflicting label.

## 3. Review UI
- [x] 3.1 Show the detected version label on each candidate card.

## 4. Scoring version 3
- [x] 4.1 Lock decision constants, migrate v2 files, accept-and-ignore stale score keys.
- [x] 4.2 Remove the three settings sliders.

## 5. Regression
- [x] 5.1 Add the anniversary-vs-band fixture and parser tests; require selected id (not group membership) in replay.
