## Context

The match page currently calls Apple playlist creation immediately and passes
only the match report's playlist name. The server accepts optional `name` and
`description` values, but generates an import description when none is sent.
The normalized playlist already stores both source fields, and the task store
retains that playlist throughout matching.

The confirmation UI needs source metadata before creation. The current match
status response exposes the match report but not the source description, so the
response shape must include a small metadata projection or the page must issue a
second playlist request.

## Goals / Non-Goals

**Goals:**

- Require an explicit confirmation before creating an Apple Music playlist.
- Initialize editable name and description fields from the source playlist.
- Keep validation and submission behavior consistent between the UI and server.
- Preserve the existing background task, success message, and error handling.
- Provide accessible English and Chinese UI.

**Non-Goals:**

- Uploading or copying playlist artwork.
- Adding creation defaults to Settings.
- Editing an Apple Music playlist after creation.
- Changing track matching or selected-track resolution.

## Decisions

### Include source metadata in the match status response

The match status route will return a small `sourcePlaylist` object containing
`name` and `description` alongside the existing report. The dialog can then open
immediately without another network request, and polling naturally keeps the
metadata available.

Fetching `/api/playlists/:id` only when the dialog opens was rejected because it
adds a visible loading state to a simple confirmation action. Copying the
description into `AppleMatchReport` was rejected because source display metadata
does not belong in the matching result format.

### Keep a local draft that resets each time the dialog opens

Opening the dialog creates a fresh draft from `sourcePlaylist.name` and
`sourcePlaylist.description`. Canceling discards the draft. Reopening therefore
shows the persisted source values rather than abandoned edits from a prior
attempt.

The name field is a single-line input and the description is a multiline
textarea. Missing descriptions become an empty string. A missing source name
uses the existing `Imported Playlist` fallback.

### Validate at both UI and route boundaries

The confirm action is disabled when the trimmed name is empty, and an inline
validation message is shown after the user clears or submits the field. The
server independently rejects an explicitly empty or non-string name and a
non-string description with `400`.

For backward compatibility, callers that omit metadata still receive source
playlist defaults. The server changes its description fallback from the
generated `Imported from ...` text to the source description or an empty string.

### Keep creation in the existing request lifecycle

Confirming calls the existing create endpoint with `playlistId`, `name`, and
`description`. While the request is active, dialog fields and actions are
disabled to prevent duplicate submissions. Success closes the dialog and uses
the existing success state; failure keeps the dialog open with the entered
values and displays the server error for retry.

The dialog uses `role="dialog"`, `aria-modal`, an associated title, initial focus
on the name input, Escape-to-close only while idle, focus containment, and focus
return to the trigger.

## Risks / Trade-offs

- **Polling response grows slightly** -> Return only name and description, not
  the full source playlist or tracks.
- **Old persisted tasks have missing metadata** -> Use stable empty/fallback
  values; no migration is required.
- **A creation request fails after the user edits metadata** -> Keep the dialog
  and draft open so retry does not lose the edits.
- **Duplicate clicks create duplicate Apple playlists** -> Disable all submit
  paths immediately when creation begins and reuse the existing server task
  status.

## Migration Plan

1. Extend the match-status response and web type with optional source metadata.
2. Add the confirmation dialog and route the create button through it.
3. Tighten server validation while retaining omitted-field fallbacks.
4. Add UI-state, route, localization, and build tests.

The response addition is backward compatible. Rollback removes the optional
field and dialog without changing persisted task or report data.

## Open Questions

None.
