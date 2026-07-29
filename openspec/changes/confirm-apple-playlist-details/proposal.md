## Why

Creating an Apple Music playlist currently starts immediately with no chance to
review its metadata. Users need a deliberate confirmation step so they can keep
the source playlist's name and description or edit either value before the
playlist is created.

## What Changes

- Replace the immediate "Create Apple Music Playlist" action with a confirmation
  dialog.
- Pre-fill the dialog's name and description fields from the normalized source
  playlist.
- Allow the user to edit both fields before confirming creation.
- Require a non-empty playlist name, while allowing an empty description.
- Submit the confirmed values through the existing Apple playlist creation
  route and preserve the current loading, success, and failure behavior.
- Add English and Chinese labels, validation messages, and accessible dialog
  behavior.
- Do not add cover upload, source-cover controls, or related Settings options.

## Capabilities

### New Capabilities

- `apple-playlist-creation-confirmation`: Defines the metadata confirmation
  dialog, source-metadata defaults, validation, submission, and error behavior
  for Apple Music playlist creation.

### Modified Capabilities

None.

## Impact

The main changes affect `web/src/pages/MatchPage.tsx`, a new reusable dialog
component, the web API request type, bilingual match-page translations, and
playlist-creation route validation. The existing normalized playlist
`description` field and QQ/NetEase adapters already supply the source metadata,
so no provider-fetching changes are required. The Apple Music API call remains
JSON-only and receives the confirmed name and description; no new runtime
dependency or persisted preference is introduced.
