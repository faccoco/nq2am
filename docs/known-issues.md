# Known Issues

## Exact titles and similar albums can still refer to different recordings

Apple Music candidates are sorted first by the normalized title string's
Levenshtein distance from the source title. Candidates with the same title
distance are then sorted by normalized album-name distance when both album names
are available. A title distance other than `0` is rejected as not found.

When the selected title distance is `0` but the album distance is not `0`, the
result remains matched and is marked as **Same track** (`相同曲目`). Artist,
duration, explicit rating, and version metadata do not affect automatic
selection.

This intentionally simple rule can still choose the wrong recording when
multiple songs share both a title and a similar album name. Candidates with the
same distances retain Apple Music's original search order. If album distance
cannot be calculated, comparable candidates with album metadata are preferred;
otherwise the original search order is retained. Matches can be changed manually
in the match report.
