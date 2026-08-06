# Known Issues

## Localized Apple Music artist names can lower match scores

Apple Music may return localized artist names that the current string-based
scorer does not recognize as the same artist. For example:

- NetEase source artist: `David Garrett`
- Apple Music China artist: `大卫・葛瑞特`
- Track: `Carnival of Venice`
- ISRC in both Apple Music China and US catalogs: `GBUM71305794`

The current scorer gives the artist field `0`, resulting in a total score of
`0.60`, below the default `0.70` threshold. An ISRC lookup in the US storefront
returns the artist as `David Garrett`, confirming that the localized Chinese
entry represents the same recording.

A future fix could use cross-storefront ISRC metadata or multilingual artist
aliases instead of treating unresolved cross-script names as definite
mismatches.
