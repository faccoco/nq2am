export type MusicProvider = "qq" | "netease" | "apple";

export type NormalizedTrack = {
  originalName: string;
  artists: string[];
  albumName?: string;
  albumArtist?: string;
  albumCoverUrl?: string;
  durationMs?: number;
  source: { provider: MusicProvider; playlistId?: string; songId?: string };
};

export type NormalizedPlaylist = {
  provider: MusicProvider;
  id?: string;
  name?: string;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  tracks: NormalizedTrack[];
};

/** A provider-agnostic track in a portable playlist file. */
export type PortableTrack = {
  name?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
};

/** The `nq2am-playlist` JSON envelope exported/imported by the UI. */
export type PortablePlaylistFile = {
  format: "nq2am-playlist";
  version: 1;
  name?: string;
  description?: string;
  provider?: MusicProvider;
  tracks: PortableTrack[];
};

export type AppleMatchStatus =
  | "not_implemented"
  | "matched"
  | "not_found"
  | "ambiguous"
  | "request_failed";

export type AppleRequestFailure = {
  kind: "timeout" | "rate_limited" | "http" | "network" | "session" | "unknown";
  operation?: "session" | "storefront" | "search" | "isrc" | "create_playlist";
  status?: number;
  attempts?: number;
};

export type AppleContentRating = "explicit" | "clean";

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
  titleDistance: number;
  albumDistance?: number;
  isrc?: string;
  storefront?: string;
};

export type AppleMatchResult = {
  track: NormalizedTrack;
  status: AppleMatchStatus;
  candidates?: AppleCandidate[];
  selectedId?: string;
  selectionSource?: "auto" | "manual";
  appleMusicId?: string;
  appleMusicUrl?: string;
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

export type MatchRetryScope = "not_found" | "ambiguous" | "request_failed" | "selected" | "all";
export type MatchReviewTab = "all" | "ambiguous" | "not_found" | "request_failed" | "matched";

export type MatchPreferences = {
  storefront: string;
  matchConcurrency: number;
  appleRequestIntervalMs: number;
  appleRequestTimeoutMs: number;
  appleMaxAttempts: number;
  appleRetryBaseDelayMs: number;
  appleRandomPauseEnabled: boolean;
  appleRandomPauseMinMs: number;
  appleRandomPauseMaxMs: number;
};

export type AuthStatus = {
  qq: boolean;
  netease: boolean;
  apple: boolean;
};

export type TaskStatus =
  | "fetched"
  | "matching"
  | "matched"
  | "match_failed"
  | "creating"
  | "created"
  | "create_failed";

export type TaskSummary = {
  key: string;
  provider: MusicProvider;
  name?: string;
  createdAt: number;
  updatedAt: number;
  status: TaskStatus;
  trackCount: number;
  matched?: number;
  matchProgress?: { processed: number; total: number };
  applePlaylistId?: string;
  error?: string;
};

export type MatchJob = {
  status: TaskStatus;
  progress?: { processed: number; total: number };
  error?: string;
  sourcePlaylist: {
    name?: string;
    description?: string;
  };
  report: AppleMatchReport | null;
};
