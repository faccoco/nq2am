export type MusicProvider = "qq" | "netease" | "apple";

export type NormalizedSource = {
  provider: MusicProvider;
  playlistId?: string;
  songId?: string;
  raw: unknown;
};

export type NormalizedTrack = {
  originalName: string;
  artists: string[];
  albumName?: string;
  albumArtist?: string;
  albumCoverUrl?: string;
  /** Track length in milliseconds, when the source provides it. */
  durationMs?: number;
  source: NormalizedSource;
};

export type NormalizedPlaylist = {
  provider: MusicProvider;
  id?: string;
  name?: string;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  tracks: NormalizedTrack[];
  raw: unknown;
};

export type AppleMatchStatus = "not_implemented" | "matched" | "not_found" | "ambiguous" | "request_failed";

export type AppleContentRating = "explicit" | "clean";

export type AppleRequestOperation = "session" | "storefront" | "search" | "create_playlist";

export type AppleRequestFailure = {
  kind: "timeout" | "rate_limited" | "http" | "network" | "session" | "unknown";
  operation?: AppleRequestOperation;
  status?: number;
  attempts?: number;
};

/** A single Apple Music catalog candidate for a normalized track. */
export type AppleCandidate = {
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  url?: string;
  artworkUrl?: string;
  durationMs?: number;
  releaseDate?: string;
  contentRating?: AppleContentRating;
  /** Levenshtein distance from the source track title; lower is closer. */
  titleDistance: number;
  /** Album distance used as a title-distance tie-breaker when available. */
  albumDistance?: number;
  /** ISRC recording id, when available. */
  isrc?: string;
  /** Storefront this candidate's metadata was fetched from (e.g. "jp"). */
  storefront?: string;
};

export type AppleMatchResult = {
  track: NormalizedTrack;
  status: AppleMatchStatus;
  /** Candidates sorted by title distance, then by available album distance. */
  candidates?: AppleCandidate[];
  /** The chosen candidate id (mirrors appleMusicId for the selected one). */
  selectedId?: string;
  selectionSource?: "auto" | "manual";
  appleMusicId?: string;
  appleMusicUrl?: string;
  /** Exact title match whose album name differs from the source. */
  sameTrack?: boolean;
  reason?: string;
  requestFailure?: AppleRequestFailure;
};

export type AppleMatchReport = {
  provider: MusicProvider;
  playlistId?: string;
  playlistName?: string;
  results: AppleMatchResult[];
};

/**
 * User-tunable matching preferences. Persisted server-side and edited only
 * through the Settings UI — never hand-written.
 */
export type MatchPreferences = {
  /** Apple storefront override; empty string means auto-detect. */
  storefront: string;
  /** Maximum number of source tracks evaluated concurrently. */
  matchConcurrency: number;
  /** Minimum delay between Apple API request starts. */
  appleRequestIntervalMs: number;
  /** Timeout applied to each Apple catalog request. */
  appleRequestTimeoutMs: number;
  /** Legacy stored value; Apple catalog requests use four total attempts (three automatic retries). */
  appleMaxAttempts: number;
  /** Initial exponential-backoff delay after a transient failure. */
  appleRetryBaseDelayMs: number;
  /** Add a randomized pause between Apple API request starts. */
  appleRandomPauseEnabled: boolean;
  /** Minimum additional randomized pause. */
  appleRandomPauseMinMs: number;
  /** Maximum additional randomized pause. */
  appleRandomPauseMaxMs: number;
};

export const DEFAULT_MATCH_PREFERENCES: MatchPreferences = {
  storefront: "",
  matchConcurrency: 3,
  appleRequestIntervalMs: 150,
  appleRequestTimeoutMs: 15_000,
  appleMaxAttempts: 4,
  appleRetryBaseDelayMs: 750,
  appleRandomPauseEnabled: true,
  appleRandomPauseMinMs: 250,
  appleRandomPauseMaxMs: 750
};

export type FetchOptions = {
  cookie?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  cookieDir?: string;
  skipCookieCache?: boolean;
};
