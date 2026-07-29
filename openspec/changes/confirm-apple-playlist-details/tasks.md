## 1. Source Metadata And Route Contract

- [ ] 1.1 Add the source playlist name and description projection to the match-job response and corresponding web types.
- [ ] 1.2 Update the Apple playlist creation route to validate provided metadata and fall back to the source name, source description, `Imported Playlist`, and an empty description in that order.
- [ ] 1.3 Add route tests for edited metadata, omitted-field fallbacks, empty names, invalid types, and unchanged task status on validation failure.

## 2. Confirmation Dialog

- [ ] 2.1 Add a reusable accessible playlist-creation dialog with name and multiline description fields, inline name validation, cancel, and confirm controls.
- [ ] 2.2 Initialize a fresh dialog draft from source metadata on every open and discard unsubmitted edits on cancel.
- [ ] 2.3 Route the match-page create action through the dialog and submit the confirmed name and description to the existing API client.
- [ ] 2.4 Disable editing and dismissal during creation, close and refresh on success, and preserve the draft with an inline error on failure.

## 3. Localization And Accessibility

- [ ] 3.1 Add English and Chinese translations for the dialog title, fields, actions, validation, progress, and failure messages.
- [ ] 3.2 Implement initial focus, focus containment, idle Escape cancellation, and focus restoration to the create button.

## 4. Verification

- [ ] 4.1 Add deterministic tests for draft defaults, edit/cancel/reopen behavior, validation, duplicate-submit prevention, and failed-submit preservation.
- [ ] 4.2 Verify the dialog at desktop and mobile widths, including keyboard operation and non-overlapping translated text.
- [ ] 4.3 Run `pnpm test`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build:web`, and OpenSpec validation.
