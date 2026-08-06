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

export type AppleScoreBreakdown = {
  total: number;
  fields: {
    title: number;
    artist: number;
    album: number;
    duration: number;
    version: number;
  };
  weights: {
    title: number;
    artist: number;
    album: number;
    duration: number;
    version: number;
  };
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
  score: number;
  scoreBreakdown?: AppleScoreBreakdown;
  /** ISRC recording id, when available. */
  isrc?: string;
  /** Storefront this candidate's metadata was fetched from (e.g. "jp"). */
  storefront?: string;
};

export type AppleMatchResult = {
  track: NormalizedTrack;
  status: AppleMatchStatus;
  /** Top scored candidates (best first); kept so a user can override the pick. */
  candidates?: AppleCandidate[];
  /** The chosen candidate id (mirrors appleMusicId for the selected one). */
  selectedId?: string;
  selectionSource?: "auto" | "manual";
  appleMusicId?: string;
  appleMusicUrl?: string;
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
  /** Minimum score for an automatic match (0–1). */
  threshold: number;
  /** Favor candidates whose duration is closest to the source track. */
  preferDurationMatch: boolean;
  /** Tie-break preference when both explicit and clean versions exist. */
  explicitPreference: "explicit" | "clean" | "none";
  /** Prefer original/studio versions over remaster/live/karaoke/instrumental. */
  preferOriginalVersion: boolean;
  /** Apple storefront override; empty string means auto-detect. */
  storefront: string;
  /** Maximum number of source tracks evaluated concurrently. */
  matchConcurrency: number;
  /** Minimum delay between Apple API request starts. */
  appleRequestIntervalMs: number;
  /** Timeout applied to each Apple catalog request. */
  appleRequestTimeoutMs: number;
  /** Total attempts allowed for a transient Apple request failure. */
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
  threshold: 0.7,
  preferDurationMatch: true,
  explicitPreference: "none",
  preferOriginalVersion: true,
  storefront: "",
  matchConcurrency: 3,
  appleRequestIntervalMs: 150,
  appleRequestTimeoutMs: 15_000,
  appleMaxAttempts: 3,
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
