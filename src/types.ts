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

export type AppleMatchStatus =
  | "not_implemented"
  | "matched"
  | "not_found"
  | "score_rejected"
  | "ambiguous"
  | "request_failed";

/** Identifier for the recording-first score model. */
export const CURRENT_SCORING_VERSION = 2 as const;
export type AppleScoringVersion = typeof CURRENT_SCORING_VERSION;

export type AppleQueryVariant =
  | "original_primary_artist"
  | "base_primary_artist"
  | "base_additional_artist"
  | "base_album"
  | "base_title";

export type AppleCandidateProvenance = {
  queryId: string;
  variant: AppleQueryVariant;
  term: string;
  storefront: string;
  rank: number;
};

export type AppleRetrievalQueryDiagnostic = {
  queryId: string;
  variant: AppleQueryVariant;
  term: string;
  storefront: string;
  required: boolean;
  status: "success" | "failed";
  candidateCount: number;
  fromCache?: boolean;
  reason?: string;
};

export type AppleRetrievalDiagnostics = {
  outcome: "success" | "failed";
  queryBudget: number;
  queries: AppleRetrievalQueryDiagnostic[];
  uniqueCandidateCount: number;
  earlyStopped: boolean;
  cacheHits: number;
};

export type ParsedRecordingMetadata = {
  baseTitle: string;
  featuredArtists: string[];
  recordingFacets: string[];
  structuralFacets: string[];
  releaseFacets: string[];
};

export type AppleArtistPairEvidence = {
  source: string;
  candidate: string;
  similarity: number;
  alias: boolean;
};

export type AppleArtistEvidence = {
  primaryPair: number;
  candidateCoverage: number;
  sourceCoverage: number;
  pairs: AppleArtistPairEvidence[];
  aliases: string[];
  hasPrimaryRelationship: boolean;
};

export type AppleCandidateEvidence = {
  parsedSource: ParsedRecordingMetadata;
  parsedCandidate: ParsedRecordingMetadata;
  baseTitleSimilarity: number;
  titleSimilarity: number;
  artist: AppleArtistEvidence;
  durationSimilarity: number;
  versionCompatibility: number;
  albumSimilarity: number;
  albumBonus: number;
  artworkBonus: number;
  identityConfidence: number;
  confidence: number;
  automaticEligible: boolean;
  deterministicIdentity: boolean;
  incompatibilities: string[];
  decisiveEvidence: string[];
};

export type AppleRecordingGroupEvidence = {
  id: string;
  candidateIds: string[];
  isrc?: string;
  confidence: number;
  identityConfidence: number;
  automaticEligible: boolean;
  deterministicIdentity: boolean;
  strongestCandidateId: string;
  selectedReleaseId?: string;
  decisiveEvidence: string[];
  conflicts: string[];
};

export type AppleDecisionDiagnostics = {
  scoringVersion: AppleScoringVersion;
  bestGroupConfidence?: number;
  runnerUpGroupConfidence?: number;
  margin?: number;
  automaticThreshold: number;
  reviewThreshold: number;
  requiredMargin: number;
  rejectionCause?: string;
  decisiveEvidence: string[];
};

export type AppleContentRating = "explicit" | "clean";

export type AppleRequestOperation = "session" | "storefront" | "search" | "isrc" | "create_playlist";

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
  /** Recording-first evidence used by scoring version 2. */
  evidence?: AppleCandidateEvidence;
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
  /** ISRC recording id, when available — used to bridge across storefronts. */
  isrc?: string;
  /**
   * Catalog id of the same recording in the user's account storefront,
   * resolved via ISRC. Falls back to `id` when the candidate already comes
   * from the account store. This is the id that can actually be added to the
   * user's library.
   */
  addableId?: string;
  /** Storefront this candidate's metadata was fetched from (e.g. "jp"). */
  storefront?: string;
  /** Every bounded retrieval pass that returned this catalog entry. */
  provenance?: AppleCandidateProvenance[];
  /** Structured, explainable recording identity evidence. */
  evidence?: AppleCandidateEvidence;
  /** Recording group assigned before ambiguity evaluation. */
  recordingGroupId?: string;
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
  scoringVersion?: AppleScoringVersion;
  retrieval?: AppleRetrievalDiagnostics;
  recordingGroups?: AppleRecordingGroupEvidence[];
  decision?: AppleDecisionDiagnostics;
};

export type AppleMatchReport = {
  provider: MusicProvider;
  playlistId?: string;
  playlistName?: string;
  scoringVersion?: AppleScoringVersion;
  results: AppleMatchResult[];
};

/**
 * User-tunable matching preferences. Persisted server-side and edited only
 * through the Settings UI — never hand-written.
 */
export type MatchPreferences = {
  /** Score and decision model associated with all numeric controls below. */
  scoringVersion: AppleScoringVersion;
  /** Minimum recording-group confidence for an automatic match (0–1). */
  threshold: number;
  /** Minimum recording-group confidence retained for manual review (0–1). */
  reviewThreshold: number;
  /** Required best-group minus runner-up-group margin for automatic selection. */
  ambiguousGap: number;
  /** Favor candidates whose duration is closest to the source track. */
  preferDurationMatch: boolean;
  /** Tie-break preference when both explicit and clean versions exist. */
  explicitPreference: "explicit" | "clean" | "none";
  /** Prefer original/studio versions over remaster/live/karaoke/instrumental. */
  preferOriginalVersion: boolean;
  /** Apple storefront override; empty string means auto-detect. */
  storefront: string;
  /**
   * Search non-English tracks in their native Apple Music region (jp/kr/cn) for
   * better matches, bridging back to the account store via ISRC.
   */
  nativeSearch: boolean;
  /**
   * How to pick the native region for a track:
   * - "source": use the playlist provider (qq/netease → cn) plus script hints.
   * - "text": infer purely from the track text (kana→jp, hangul→kr, han→jp).
   */
  cjkDetection: "source" | "text";
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
  /** Timeout applied independently to artwork download and decode operations. */
  artworkTimeoutMs: number;
};

export const DEFAULT_MATCH_PREFERENCES: MatchPreferences = {
  scoringVersion: CURRENT_SCORING_VERSION,
  threshold: 0.86,
  reviewThreshold: 0.62,
  ambiguousGap: 0.08,
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
  artworkTimeoutMs: 8_000
};

export type FetchOptions = {
  cookie?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  cookieDir?: string;
  skipCookieCache?: boolean;
};
