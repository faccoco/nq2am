export { normalizeNeteasePlaylist } from "./adapters/netease.js";

export { normalizeQqPlaylist } from "./adapters/qq.js";
export type {
  AppleApiRequestMetric,
  AppleApiSession,
  AppleApiSessionOptions,
  AppleApiSessionStats
} from "./apple/api.js";
export {
  appleCreatePlaylist,
  appleGetStorefront,
  appleSearch,
  appleSongsByIsrc,
  createAppleApiSession
} from "./apple/api.js";
export type { ArtistAliasSuggestion } from "./apple/artistAliases.js";
export { extractArtistAliasSuggestions, REVIEWED_ARTIST_ALIASES } from "./apple/artistAliases.js";
export type { AppleMatchExecutionOptions, AppleMatchLogEvent } from "./apple/matcher.js";
export {
  createAppleMusicPlaylist,
  createAppleMusicPlaylistFromReport,
  detectStorefrontForTrack,
  matchAppleMusic,
  refreshAppleMatchReportCandidates,
  resolveAppleMusicTrackIds,
  retryAppleMusicResults,
  retryNotFoundAppleMusic
} from "./apple/matcher.js";
export {
  areApprovedArtistAliases,
  characterNgramSimilarity,
  compareArtistCredits,
  normalizeRecordingText,
  parseRecordingMetadata,
  recordingTextSimilarity,
  shortNameSimilarity,
  splitArtistCredits,
  tokenSimilarity
} from "./apple/recordingMetadata.js";
export { buildRecordingGroups } from "./apple/recordingResolution.js";
export type {
  DecisionReplayCategory,
  DecisionReplayItem,
  DecisionReplayReport,
  RetrievalReplayItem,
  RetrievalReplayReport,
  ThresholdSweepItem,
  ThresholdSweepRow
} from "./apple/replay.js";
export { evaluateDecisionReplay, evaluateRetrievalReplay, sweepRecordingThresholds } from "./apple/replay.js";
export {
  appleQueryCacheKey,
  buildAppleQueryPlan,
  DEFAULT_APPLE_QUERY_BUDGET,
  unionAppleSearchCandidates
} from "./apple/retrieval.js";
export { albumSimilarity, durationSimilarity, scoreAppleRecordingEvidence, scoreAppleSong } from "./apple/scoring.js";
export { interactiveLogin, loadCookies, saveCookies } from "./fetchers/auth.js";
export { closeBrowser, fetchWithBrowser } from "./fetchers/browser.js";
export { fetchNeteasePlaylist, parseNeteasePlaylistId } from "./fetchers/netease.js";
export { fetchQqPlaylist, parseQqPlaylistId } from "./fetchers/qq.js";
export type {
  AppleArtistEvidence,
  AppleArtistPairEvidence,
  AppleCandidate,
  AppleCandidateEvidence,
  AppleCandidateProvenance,
  AppleContentRating,
  AppleDecisionDiagnostics,
  AppleMatchReport,
  AppleMatchResult,
  AppleMatchStatus,
  AppleQueryVariant,
  AppleRecordingGroupEvidence,
  AppleRequestFailure,
  AppleRequestOperation,
  AppleRetrievalDiagnostics,
  AppleRetrievalQueryDiagnostic,
  AppleScoringVersion,
  FetchOptions,
  MatchPreferences,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedSource,
  NormalizedTrack,
  ParsedRecordingMetadata
} from "./types.js";
export { CURRENT_SCORING_VERSION, DEFAULT_MATCH_PREFERENCES } from "./types.js";
