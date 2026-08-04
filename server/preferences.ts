import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../src/fetchers/auth.js";
import { DEFAULT_MATCH_PREFERENCES, type MatchPreferences } from "../src/types.js";

const STORE_PATH = join(getDataDir(), "preferences.json");

let cached: MatchPreferences | undefined;

export class PreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferencesValidationError";
  }
}

function readNumber(
  input: Partial<MatchPreferences>,
  key: keyof MatchPreferences,
  fallback: number,
  min: number,
  max: number,
  integer = false
): number {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
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

function readBoolean(input: Partial<MatchPreferences>, key: keyof MatchPreferences, fallback: boolean): boolean {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new PreferencesValidationError(`${key} must be a boolean`);
  }
  return value;
}

function validate(input: unknown): MatchPreferences {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PreferencesValidationError("Preferences must be an object");
  }

  const p = input as Partial<MatchPreferences>;
  const d = DEFAULT_MATCH_PREFERENCES;
  const knownKeys = new Set(Object.keys(d));
  for (const key of Object.keys(p)) {
    if (!knownKeys.has(key)) {
      throw new PreferencesValidationError(`Unknown preference: ${key}`);
    }
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

  return {
    threshold: readNumber(p, "threshold", d.threshold, 0, 1),
    ambiguousGap: readNumber(p, "ambiguousGap", d.ambiguousGap, 0, 1),
    preferDurationMatch: readBoolean(p, "preferDurationMatch", d.preferDurationMatch),
    explicitPreference: explicit,
    preferOriginalVersion: readBoolean(p, "preferOriginalVersion", d.preferOriginalVersion),
    storefront: (p.storefront ?? d.storefront).trim().toLowerCase(),
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
  };
}

export async function getPreferences(): Promise<MatchPreferences> {
  if (cached) return cached;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    cached = validate(JSON.parse(raw));
  } catch {
    cached = { ...DEFAULT_MATCH_PREFERENCES };
  }
  return cached;
}

export async function setPreferences(input: unknown): Promise<MatchPreferences> {
  const next = validate(input);
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(next, null, 2), "utf8");
  cached = next;
  return next;
}
