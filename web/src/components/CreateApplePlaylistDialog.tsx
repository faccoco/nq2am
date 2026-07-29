import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import {
  applePlaylistDialogReducer,
  canSubmitApplePlaylist,
  createApplePlaylistDialogState,
  isApplePlaylistNameValid,
  type ApplePlaylistCreationDraft,
  type ApplePlaylistSourceMetadata,
} from "../../../src/applePlaylistCreation";

interface CreateApplePlaylistDialogProps {
  source: ApplePlaylistSourceMetadata;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: (draft: ApplePlaylistCreationDraft) => Promise<void>;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function CreateApplePlaylistDialog({
  source,
  returnFocusRef,
  onCancel,
  onConfirm,
}: CreateApplePlaylistDialogProps) {
  const { t } = useTranslation("match");
  const [state, dispatch] = useReducer(
    applePlaylistDialogReducer,
    source,
    createApplePlaylistDialogState,
  );
  const titleId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const submitErrorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const nameInvalid =
    state.nameTouched && !isApplePlaylistNameValid(state.draft.name);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameInputRef.current?.focus();
    nameInputRef.current?.select();

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);

  function cancel() {
    if (!state.submitting) onCancel();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !state.submitting) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlightRef.current || !canSubmitApplePlaylist(state)) {
      dispatch({ type: "submit_started" });
      return;
    }

    submitInFlightRef.current = true;
    dispatch({ type: "submit_started" });
    try {
      await onConfirm({
        name: state.draft.name.trim(),
        description: state.draft.description,
      });
      dispatch({ type: "submit_succeeded" });
    } catch (error) {
      dispatch({
        type: "submit_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      submitInFlightRef.current = false;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={state.error ? submitErrorId : undefined}
        aria-busy={state.submitting}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-600 bg-slate-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-white">
            {t("createDialog.title")}
          </h2>
          <button
            type="button"
            onClick={cancel}
            disabled={state.submitting}
            className="flex h-8 w-8 items-center justify-center rounded-md text-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("createDialog.close")}
            title={t("createDialog.close")}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="max-h-[calc(100vh-11rem)] space-y-5 overflow-y-auto px-5 py-5">
            <div>
              <label
                htmlFor={nameId}
                className="mb-1.5 block text-sm font-medium text-slate-200"
              >
                {t("createDialog.name")}
              </label>
              <input
                ref={nameInputRef}
                id={nameId}
                type="text"
                value={state.draft.name}
                onChange={(event) =>
                  dispatch({ type: "name_changed", value: event.target.value })
                }
                onBlur={() => dispatch({ type: "name_blurred" })}
                disabled={state.submitting}
                aria-invalid={nameInvalid}
                aria-describedby={nameInvalid ? nameErrorId : undefined}
                className={`w-full rounded-md border bg-slate-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  nameInvalid
                    ? "border-red-500/70 focus:border-red-400 focus:ring-red-500/30"
                    : "border-slate-600 focus:border-indigo-400 focus:ring-indigo-500/30"
                }`}
              />
              {nameInvalid && (
                <p id={nameErrorId} className="mt-1.5 text-sm text-red-300">
                  {t("createDialog.nameRequired")}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={descriptionId}
                className="mb-1.5 block text-sm font-medium text-slate-200"
              >
                {t("createDialog.description")}
              </label>
              <textarea
                id={descriptionId}
                rows={5}
                value={state.draft.description}
                onChange={(event) =>
                  dispatch({
                    type: "description_changed",
                    value: event.target.value,
                  })
                }
                disabled={state.submitting}
                className="w-full resize-y rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm leading-6 text-white outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {state.error && (
              <div
                id={submitErrorId}
                role="alert"
                className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
              >
                {t("createDialog.failure", { error: state.error })}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-700 bg-slate-900 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancel}
              disabled={state.submitting}
              className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("createDialog.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmitApplePlaylist(state)}
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.submitting
                ? t("createDialog.creating")
                : t("createDialog.confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
