import assert from "node:assert/strict";
import test from "node:test";
import {
  applePlaylistDialogReducer,
  canSubmitApplePlaylist,
  createApplePlaylistDialogState,
  createApplePlaylistDraft,
  DEFAULT_APPLE_PLAYLIST_NAME
} from "../src/applePlaylistCreation.js";

test("playlist creation draft uses source metadata and stable fallbacks", () => {
  assert.deepEqual(
    createApplePlaylistDraft({
      name: "  Source Playlist  ",
      description: "Source description"
    }),
    {
      name: "Source Playlist",
      description: "Source description"
    }
  );
  assert.deepEqual(createApplePlaylistDraft(), {
    name: DEFAULT_APPLE_PLAYLIST_NAME,
    description: ""
  });
});

test("opening a new dialog discards edits from a cancelled draft", () => {
  const source = {
    name: "Source Playlist",
    description: "Source description"
  };
  let state = createApplePlaylistDialogState(source);
  state = applePlaylistDialogReducer(state, {
    type: "name_changed",
    value: "Edited name"
  });
  state = applePlaylistDialogReducer(state, {
    type: "description_changed",
    value: "Edited description"
  });

  assert.deepEqual(createApplePlaylistDialogState(source).draft, {
    name: "Source Playlist",
    description: "Source description"
  });
});

test("empty playlist names fail validation", () => {
  let state = createApplePlaylistDialogState({ name: "Source Playlist" });
  state = applePlaylistDialogReducer(state, {
    type: "name_changed",
    value: "   "
  });
  state = applePlaylistDialogReducer(state, { type: "submit_started" });

  assert.equal(state.nameTouched, true);
  assert.equal(state.submitting, false);
  assert.equal(canSubmitApplePlaylist(state), false);
});

test("a submitting dialog ignores duplicate submit and edit actions", () => {
  const initial = createApplePlaylistDialogState({ name: "Source Playlist" });
  const submitting = applePlaylistDialogReducer(initial, {
    type: "submit_started"
  });

  assert.equal(submitting.submitting, true);
  assert.equal(canSubmitApplePlaylist(submitting), false);
  assert.equal(applePlaylistDialogReducer(submitting, { type: "submit_started" }), submitting);
  assert.equal(
    applePlaylistDialogReducer(submitting, {
      type: "name_changed",
      value: "Ignored edit"
    }),
    submitting
  );
});

test("failed creation preserves the edited draft and permits retry", () => {
  let state = createApplePlaylistDialogState({
    name: "Source Playlist",
    description: "Source description"
  });
  state = applePlaylistDialogReducer(state, {
    type: "name_changed",
    value: "Edited name"
  });
  state = applePlaylistDialogReducer(state, {
    type: "description_changed",
    value: "Edited description"
  });
  const editedDraft = state.draft;
  state = applePlaylistDialogReducer(state, { type: "submit_started" });
  state = applePlaylistDialogReducer(state, {
    type: "submit_failed",
    error: "Apple Music request failed"
  });

  assert.deepEqual(state.draft, editedDraft);
  assert.equal(state.submitting, false);
  assert.equal(state.error, "Apple Music request failed");
  assert.equal(canSubmitApplePlaylist(state), true);
});
