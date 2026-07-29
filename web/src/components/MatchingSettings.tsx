import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { MatchPreferences } from "../types";

const DEFAULTS: MatchPreferences = {
  threshold: 0.7,
  ambiguousGap: 0.1,
  preferDurationMatch: true,
  explicitPreference: "none",
  preferOriginalVersion: true,
  storefront: "",
  nativeSearch: true,
  cjkDetection: "source",
  matchConcurrency: 3,
  appleRequestIntervalMs: 150,
  appleRequestTimeoutMs: 15_000,
  appleMaxAttempts: 3,
  appleRetryBaseDelayMs: 750,
  appleRandomPauseEnabled: true,
  appleRandomPauseMinMs: 250,
  appleRandomPauseMaxMs: 750,
  artworkTimeoutMs: 8_000,
};

export default function MatchingSettings() {
  const { t } = useTranslation("settings");
  const [prefs, setPrefs] = useState<MatchPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPreferences()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(p: Partial<MatchPreferences>) {
    setPrefs((prev) => ({ ...(prev ?? DEFAULTS), ...p }));
    setSaved(false);
  }

  async function save() {
    if (!prefs) return;
    if (prefs.appleRandomPauseMinMs > prefs.appleRandomPauseMaxMs) {
      setSaved(false);
      setError(t("matching.performance.randomPause.rangeError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api.putPreferences(prefs);
      setPrefs(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-400">
        {t("matching.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-800 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{t("matching.title")}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {t("matching.description")}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <FieldTitle tooltip={t("matching.threshold.tooltip")}>
            {t("matching.threshold.label")}{" "}
            <span className="font-mono text-slate-100">
              {prefs.threshold.toFixed(2)}
            </span>
          </FieldTitle>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.threshold}
            onChange={(e) => patch({ threshold: Number(e.target.value) })}
            className="accent-indigo-500"
          />
          <span className="text-xs text-slate-500">
            {t("matching.threshold.help")}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <FieldTitle tooltip={t("matching.ambiguityGap.tooltip")}>
            {t("matching.ambiguityGap.label")}{" "}
            <span className="font-mono text-slate-100">
              {prefs.ambiguousGap.toFixed(2)}
            </span>
          </FieldTitle>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={prefs.ambiguousGap}
            onChange={(e) => patch({ ambiguousGap: Number(e.target.value) })}
            className="accent-indigo-500"
          />
          <span className="text-xs text-slate-500">
            {t("matching.ambiguityGap.help")}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <FieldTitle tooltip={t("matching.explicit.tooltip")}>
            {t("matching.explicit.label")}
          </FieldTitle>
          <select
            value={prefs.explicitPreference}
            onChange={(e) =>
              patch({
                explicitPreference: e.target
                  .value as MatchPreferences["explicitPreference"],
              })
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="none">{t("matching.explicit.options.none")}</option>
            <option value="explicit">
              {t("matching.explicit.options.explicit")}
            </option>
            <option value="clean">
              {t("matching.explicit.options.clean")}
            </option>
          </select>
          <span className="text-xs text-slate-500">
            {t("matching.explicit.help")}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <FieldTitle tooltip={t("matching.storefront.tooltip")}>
            {t("matching.storefront.label")}
          </FieldTitle>
          <input
            type="text"
            value={prefs.storefront}
            onChange={(e) => patch({ storefront: e.target.value })}
            placeholder={t("matching.storefront.placeholder")}
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">
            {t("matching.storefront.help")}
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.preferDurationMatch}
            onChange={(e) => patch({ preferDurationMatch: e.target.checked })}
          />
          <FieldTitle tooltip={t("matching.preferDurationTooltip")}>
            {t("matching.preferDuration")}
          </FieldTitle>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.preferOriginalVersion}
            onChange={(e) => patch({ preferOriginalVersion: e.target.checked })}
          />
          <FieldTitle tooltip={t("matching.preferOriginalTooltip")}>
            {t("matching.preferOriginal")}
          </FieldTitle>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.nativeSearch}
            onChange={(e) => patch({ nativeSearch: e.target.checked })}
          />
          <FieldTitle tooltip={t("matching.nativeSearchTooltip")}>
            {t("matching.nativeSearch")}
          </FieldTitle>
        </label>
        <span className="ml-6 text-xs text-slate-500">
          {t("matching.nativeSearchHelp")}
        </span>
      </div>

      {prefs.nativeSearch && (
        <label className="flex max-w-sm flex-col gap-1 text-sm text-slate-300">
          <FieldTitle tooltip={t("matching.cjk.tooltip")}>
            {t("matching.cjk.label")}
          </FieldTitle>
          <select
            value={prefs.cjkDetection}
            onChange={(e) =>
              patch({
                cjkDetection: e.target
                  .value as MatchPreferences["cjkDetection"],
              })
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="source">{t("matching.cjk.options.source")}</option>
            <option value="text">{t("matching.cjk.options.text")}</option>
          </select>
          <span className="text-xs text-slate-500">{t("matching.cjk.help")}</span>
        </label>
      )}

      <section className="space-y-4 border-t border-slate-700 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            {t("matching.performance.title")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("matching.performance.description")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberPreference
            label={t("matching.performance.concurrency.label")}
            tooltip={t("matching.performance.concurrency.tooltip")}
            help={t("matching.performance.concurrency.help")}
            value={prefs.matchConcurrency}
            min={1}
            max={10}
            onChange={(value) => patch({ matchConcurrency: value })}
          />
          <NumberPreference
            label={t("matching.performance.interval.label")}
            tooltip={t("matching.performance.interval.tooltip")}
            help={t("matching.performance.interval.help")}
            value={prefs.appleRequestIntervalMs}
            min={0}
            max={10_000}
            step={50}
            unit="ms"
            onChange={(value) => patch({ appleRequestIntervalMs: value })}
          />
          <NumberPreference
            label={t("matching.performance.requestTimeout.label")}
            tooltip={t("matching.performance.requestTimeout.tooltip")}
            help={t("matching.performance.requestTimeout.help")}
            value={prefs.appleRequestTimeoutMs}
            min={1_000}
            max={120_000}
            step={1_000}
            unit="ms"
            onChange={(value) => patch({ appleRequestTimeoutMs: value })}
          />
          <NumberPreference
            label={t("matching.performance.maxAttempts.label")}
            tooltip={t("matching.performance.maxAttempts.tooltip")}
            help={t("matching.performance.maxAttempts.help")}
            value={prefs.appleMaxAttempts}
            min={1}
            max={10}
            onChange={(value) => patch({ appleMaxAttempts: value })}
          />
          <NumberPreference
            label={t("matching.performance.retryDelay.label")}
            tooltip={t("matching.performance.retryDelay.tooltip")}
            help={t("matching.performance.retryDelay.help")}
            value={prefs.appleRetryBaseDelayMs}
            min={0}
            max={60_000}
            step={250}
            unit="ms"
            onChange={(value) => patch({ appleRetryBaseDelayMs: value })}
          />
          <NumberPreference
            label={t("matching.performance.artworkTimeout.label")}
            tooltip={t("matching.performance.artworkTimeout.tooltip")}
            help={t("matching.performance.artworkTimeout.help")}
            value={prefs.artworkTimeoutMs}
            min={1_000}
            max={120_000}
            step={1_000}
            unit="ms"
            onChange={(value) => patch({ artworkTimeoutMs: value })}
          />
        </div>

        <div className="space-y-3 border-t border-slate-700/70 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <FieldTitle tooltip={t("matching.performance.randomPause.tooltip")}>
                <span className="text-sm text-slate-200">
                  {t("matching.performance.randomPause.label")}
                </span>
              </FieldTitle>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {t("matching.performance.randomPause.help")}
              </p>
            </div>
            <Toggle
              checked={prefs.appleRandomPauseEnabled}
              label={t("matching.performance.randomPause.label")}
              onChange={(checked) => patch({ appleRandomPauseEnabled: checked })}
            />
          </div>

          {prefs.appleRandomPauseEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberPreference
                label={t("matching.performance.randomPause.minLabel")}
                tooltip={t("matching.performance.randomPause.minTooltip")}
                value={prefs.appleRandomPauseMinMs}
                min={0}
                max={60_000}
                step={50}
                unit="ms"
                onChange={(value) => patch({ appleRandomPauseMinMs: value })}
              />
              <NumberPreference
                label={t("matching.performance.randomPause.maxLabel")}
                tooltip={t("matching.performance.randomPause.maxTooltip")}
                value={prefs.appleRandomPauseMaxMs}
                min={0}
                max={60_000}
                step={50}
                unit="ms"
                onChange={(value) => patch({ appleRandomPauseMaxMs: value })}
              />
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {saving ? t("matching.saving") : t("matching.save")}
        </button>
        {saved && (
          <span className="text-sm text-green-300">{t("matching.saved")}</span>
        )}
      </div>
    </div>
  );
}

function NumberPreference({
  label,
  tooltip,
  help,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  tooltip: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-300">
      <FieldTitle tooltip={tooltip}>{label}</FieldTitle>
      <span className="flex min-w-0 items-center rounded-md border border-slate-600 bg-slate-900 focus-within:border-indigo-500">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-slate-100 outline-none"
        />
        {unit && (
          <span className="border-l border-slate-700 px-3 text-xs text-slate-500">
            {unit}
          </span>
        )}
      </span>
      {help && <span className="text-xs text-slate-500">{help}</span>}
    </label>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full border transition ${
        checked
          ? "border-indigo-400 bg-indigo-500"
          : "border-slate-600 bg-slate-700"
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function FieldTitle({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="min-w-0">{children}</span>
      <HelpTooltip text={tooltip} />
    </span>
  );
}

function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex flex-shrink-0 align-middle">
      <span
        tabIndex={0}
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[10px] font-bold leading-none text-slate-300 outline-none transition hover:border-indigo-400 hover:text-indigo-200 focus:border-indigo-400 focus:text-indigo-200"
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-30 hidden w-72 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-relaxed text-slate-200 shadow-xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}
