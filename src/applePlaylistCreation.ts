export const DEFAULT_APPLE_PLAYLIST_NAME = "Imported Playlist";

export interface ApplePlaylistSourceMetadata {
  name?: string;
  description?: string;
}

export interface ApplePlaylistCreationDraft {
  name: string;
  description: string;
}

export interface ApplePlaylistDialogState {
  draft: ApplePlaylistCreationDraft;
  nameTouched: boolean;
  submitting: boolean;
  completed: boolean;
  error: string | null;
}

export type ApplePlaylistDialogAction =
  | { type: "name_changed"; value: string }
  | { type: "description_changed"; value: string }
  | { type: "name_blurred" }
  | { type: "submit_started" }
  | { type: "submit_failed"; error: string }
  | { type: "submit_succeeded" };

export function createApplePlaylistDraft(source?: ApplePlaylistSourceMetadata): ApplePlaylistCreationDraft {
  return {
    name: source?.name?.trim() || DEFAULT_APPLE_PLAYLIST_NAME,
    description: source?.description ?? ""
  };
}

export function createApplePlaylistDialogState(source?: ApplePlaylistSourceMetadata): ApplePlaylistDialogState {
  return {
    draft: createApplePlaylistDraft(source),
    nameTouched: false,
    submitting: false,
    completed: false,
    error: null
  };
}

export function isApplePlaylistNameValid(name: string): boolean {
  return name.trim().length > 0;
}

export function canSubmitApplePlaylist(state: ApplePlaylistDialogState): boolean {
  return !state.submitting && isApplePlaylistNameValid(state.draft.name);
}

export function applePlaylistDialogReducer(
  state: ApplePlaylistDialogState,
  action: ApplePlaylistDialogAction
): ApplePlaylistDialogState {
  if (
    state.submitting &&
    (action.type === "name_changed" ||
      action.type === "description_changed" ||
      action.type === "name_blurred" ||
      action.type === "submit_started")
  ) {
    return state;
  }

  switch (action.type) {
    case "name_changed":
      return {
        ...state,
        draft: { ...state.draft, name: action.value },
        nameTouched: true,
        error: null
      };
    case "description_changed":
      return {
        ...state,
        draft: { ...state.draft, description: action.value },
        error: null
      };
    case "name_blurred":
      return { ...state, nameTouched: true };
    case "submit_started":
      if (!isApplePlaylistNameValid(state.draft.name)) {
        return { ...state, nameTouched: true };
      }
      return {
        ...state,
        nameTouched: true,
        submitting: true,
        error: null
      };
    case "submit_failed":
      return {
        ...state,
        submitting: false,
        error: action.error
      };
    case "submit_succeeded":
      return {
        ...state,
        submitting: false,
        completed: true,
        error: null
      };
  }
}
