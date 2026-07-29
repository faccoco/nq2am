## ADDED Requirements

### Requirement: Creation requires metadata confirmation

The system SHALL open a confirmation dialog instead of immediately creating an
Apple Music playlist when the user activates the create action.

#### Scenario: User opens the confirmation dialog

- **WHEN** a matched playlist has at least one matched track and the user activates "Create Apple Music Playlist"
- **THEN** the system displays an Apple playlist metadata confirmation dialog without sending a creation request

#### Scenario: User cancels confirmation

- **WHEN** the confirmation dialog is open and idle and the user cancels it
- **THEN** the system closes the dialog and does not send a creation request

### Requirement: Source metadata is pre-filled

The system SHALL initialize the creation draft from the normalized source
playlist's name and description each time the dialog opens.

#### Scenario: Source name and description are available

- **WHEN** the dialog opens for a source playlist with a name and description
- **THEN** the name and description fields contain those source values

#### Scenario: Source description is unavailable

- **WHEN** the dialog opens for a source playlist without a description
- **THEN** the description field is empty and remains optional

#### Scenario: Source name is unavailable

- **WHEN** the dialog opens for a source playlist without a usable name
- **THEN** the name field contains the stable "Imported Playlist" fallback

#### Scenario: Canceled edits are discarded

- **WHEN** the user edits metadata, cancels the dialog, and opens it again
- **THEN** the fields are reset from the source metadata rather than the canceled draft

### Requirement: Metadata is editable and validated

The system SHALL allow editing both fields, SHALL require a non-empty trimmed
name, and SHALL allow an empty description.

#### Scenario: User edits valid metadata

- **WHEN** the user enters a non-empty name and any description
- **THEN** the confirm action is enabled and the draft retains the entered values

#### Scenario: User clears the name

- **WHEN** the name contains only whitespace
- **THEN** the system prevents confirmation and displays a localized validation message

#### Scenario: Server receives invalid metadata

- **WHEN** the create route receives an explicitly empty or non-string name or a non-string description
- **THEN** the server returns `400` and does not call Apple Music

### Requirement: Confirmed metadata is submitted once

The system SHALL send the confirmed name and description through the existing
Apple playlist creation route exactly once per confirmation.

#### Scenario: Creation succeeds

- **WHEN** the user confirms valid metadata and Apple Music returns a playlist ID
- **THEN** the system closes the dialog, records the playlist ID, and displays the existing success state

#### Scenario: Creation is in progress

- **WHEN** a confirmed creation request is pending
- **THEN** the system disables the dialog fields, cancel action, close action, and confirm action

#### Scenario: Creation fails

- **WHEN** the confirmed creation request fails
- **THEN** the system keeps the dialog open, preserves the draft, and displays the error without issuing another request automatically

### Requirement: Omitted API metadata uses source defaults

The server SHALL preserve compatibility for callers that omit the optional name
or description fields.

#### Scenario: Name is omitted

- **WHEN** a valid create request omits `name`
- **THEN** the server uses the source playlist name or "Imported Playlist" when no source name exists

#### Scenario: Description is omitted

- **WHEN** a valid create request omits `description`
- **THEN** the server uses the source playlist description or an empty string when no source description exists

### Requirement: Dialog is localized and accessible

The confirmation dialog SHALL provide English and Chinese text and keyboard
accessible dialog behavior.

#### Scenario: Keyboard user opens and closes the dialog

- **WHEN** a keyboard user opens the dialog and later closes it while no request is pending
- **THEN** focus starts in the name field, remains within the dialog while open, and returns to the create trigger after close

#### Scenario: User changes language

- **WHEN** the application language is English or Chinese
- **THEN** the dialog title, field labels, actions, validation, and errors use the selected language
