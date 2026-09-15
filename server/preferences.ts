import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../src/fetchers/auth.js";
import { CURRENT_SCORING_VERSION, DEFAULT_MATCH_PREFERENCES, type MatchPreferences } from "../src/types.js";

const STORE_PATH = join(getDataDir(), "preferences.json");

let cached: MatchPreferences | undefined;

export class PreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferencesValidationError";
  }
}

type PreferenceInput = Partial<Record<keyof MatchPreferences, unknown>>;

function readNumber(
  input: PreferenceInput,
  key: keyof MatchPreferences,
  fallback: number,
  min: number,
  max: number,
  integer = false
): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PreferencesValidationError(`${key} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new PreferencesValidationError(`${key} must be between ${min} and ${max}`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new PreferencesValidationError(`${key} must be an integer`);
  }
  return value;
}

function readBoolean(input: PreferenceInput, key: keyof MatchPreferences, fallback: boolean): boolean {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new PreferencesValidationError(`${key} must be a boolean`);
  return value;
}

function validate(input: unknown): { preferences: MatchPreferences; migrated: boolean } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PreferencesValidationError("Preferences must be an object");
  }

  const p = input as PreferenceInput;
  const d = DEFAULT_MATCH_PREFERENCES;
  const knownKeys = new Set(Object.keys(d));
  for (const key of Object.keys(p)) {
    if (!knownKeys.has(key)) throw new PreferencesValidationError(`Unknown preference: ${key}`);
  }

  const requestedVersion = p.scoringVersion;
  const migratable =
    requestedVersion === undefined || requestedVersion === 2 || requestedVersion === CURRENT_SCORING_VERSION;
  if (!migratable) {
    throw new PreferencesValidationError(`Unsupported scoringVersion: ${String(requestedVersion)}`);
  }

  const explicit = p.explicitPreference ?? d.explicitPreference;
  if (explicit !== "explicit" && explicit !== "clean" && explicit !== "none") {
    throw new PreferencesValidationError("explicitPreference must be explicit, clean, or none");
  }
  const cjk = p.cjkDetection ?? d.cjkDetection;
  if (cjk !== "source" && cjk !== "text") {
    throw new PreferencesValidationError("cjkDetection must be source or text");
  }
  if (p.storefront !== undefined && typeof p.storefront !== "string") {
    throw new PreferencesValidationError("storefront must be a string");
  }

  const randomPauseMinMs = readNumber(p, "appleRandomPauseMinMs", d.appleRandomPauseMinMs, 0, 60_000, true);
  const randomPauseMaxMs = readNumber(p, "appleRandomPauseMaxMs", d.appleRandomPauseMaxMs, 0, 60_000, true);
  if (randomPauseMinMs > randomPauseMaxMs) {
    throw new PreferencesValidationError("appleRandomPauseMinMs must be less than or equal to appleRandomPauseMaxMs");
  }

  // Decision thresholds are internals of the current scoring version. Legacy
  // files and stale clients may still send the keys; accept and ignore them.
  const migrated = requestedVersion !== CURRENT_SCORING_VERSION;

  return {
    migrated,
    preferences: {
      scoringVersion: CURRENT_SCORING_VERSION,
      threshold: d.threshold,
      reviewThreshold: d.reviewThreshold,
      ambiguousGap: d.ambiguousGap,
      preferDurationMatch: readBoolean(p, "preferDurationMatch", d.preferDurationMatch),
      explicitPreference: explicit,
      preferOriginalVersion: readBoolean(p, "preferOriginalVersion", d.preferOriginalVersion),
      storefront: ((p.storefront as string | undefined) ?? d.storefront).trim().toLowerCase(),
      nativeSearch: readBoolean(p, "nativeSearch", d.nativeSearch),
      cjkDetection: cjk,
      matchConcurrency: readNumber(p, "matchConcurrency", d.matchConcurrency, 1, 10, true),
      appleRequestIntervalMs: readNumber(p, "appleRequestIntervalMs", d.appleRequestIntervalMs, 0, 10_000, true),
      appleRequestTimeoutMs: readNumber(p, "appleRequestTimeoutMs", d.appleRequestTimeoutMs, 1_000, 120_000, true),
      appleMaxAttempts: readNumber(p, "appleMaxAttempts", d.appleMaxAttempts, 1, 10, true),
      appleRetryBaseDelayMs: readNumber(p, "appleRetryBaseDelayMs", d.appleRetryBaseDelayMs, 0, 60_000, true),
      appleRandomPauseEnabled: readBoolean(p, "appleRandomPauseEnabled", d.appleRandomPauseEnabled),
      appleRandomPauseMinMs: randomPauseMinMs,
      appleRandomPauseMaxMs: randomPauseMaxMs,
      artworkTimeoutMs: readNumber(p, "artworkTimeoutMs", d.artworkTimeoutMs, 1_000, 120_000, true)
    }
  };
}

async function persistPreferences(preferences: MatchPreferences): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(preferences, null, 2), "utf8");
}

export async function getPreferences(): Promise<MatchPreferences> {
  if (cached) return cached;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const { preferences, migrated } = validate(JSON.parse(raw));
    cached = preferences;
    if (migrated) await persistPreferences(preferences);
  } catch {
    cached = { ...DEFAULT_MATCH_PREFERENCES };
  }
  return cached;
}

export async function setPreferences(input: unknown): Promise<MatchPreferences> {
  const { preferences: next } = validate(input);
  await persistPreferences(next);
  cached = next;
  return next;
}
