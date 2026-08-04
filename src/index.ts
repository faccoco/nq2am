export type { PortablePlaylistFile, PortableTrack } from "./adapters/file.js";
export { normalizePlaylistFile, toPortablePlaylist, toPortableTrack } from "./adapters/file.js";
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
  createAppleApiSession
} from "./apple/api.js";
export type { AppleMatchExecutionOptions, AppleMatchLogEvent } from "./apple/matcher.js";
export {
  createAppleMusicPlaylist,
  createAppleMusicPlaylistFromReport,
  matchAppleMusic,
  refreshAppleMatchReportCandidates,
  resolveAppleMusicTrackIds,
  retryAppleMusicResults,
  retryNotFoundAppleMusic
} from "./apple/matcher.js";
export { interactiveLogin, loadCookies, saveCookies } from "./fetchers/auth.js";
export { closeBrowser, fetchWithBrowser } from "./fetchers/browser.js";
export { fetchNeteasePlaylist, parseNeteasePlaylistId } from "./fetchers/netease.js";
export { fetchQqPlaylist, parseQqPlaylistId } from "./fetchers/qq.js";
export type {
  AppleCandidate,
  AppleContentRating,
  AppleMatchReport,
  AppleMatchResult,
  AppleMatchStatus,
  AppleRequestFailure,
  AppleRequestOperation,
  FetchOptions,
  MatchPreferences,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedSource,
  NormalizedTrack
} from "./types.js";
export { DEFAULT_MATCH_PREFERENCES } from "./types.js";
