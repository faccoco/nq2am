import { performance } from "node:perf_hooks";
import { loadCookies } from "../fetchers/auth.js";
import { getNotFoundIndices } from "../matchFilters.js";
import {
  type AppleCandidate,
  type AppleMatchReport,
  type AppleMatchResult,
  DEFAULT_MATCH_PREFERENCES,
  type MatchPreferences,
  type NormalizedPlaylist,
  type NormalizedTrack
} from "../types.js";
import {
  type AppleApiRequestMetric,
  type AppleApiSession,
  type AppleApiSessionOptions,
  type AppleSong,
  appleCreatePlaylist,
  createAppleApiSession
} from "./api.js";
import { mapWithConcurrency } from "./concurrency.js";
import { describeAppleRequestFailure } from "./requestFailure.js";
import { runWithRetry } from "./requestScheduler.js";
import {
  albumLevenshteinDistance,
  normalizeAlbumMetadata,
  normalizeTitleMetadata,
  titleLevenshteinDistance
} from "./titleDistance.js";

export type AppleMatchLogEvent = {
  event: "request" | "stage" | "job_complete";
  jobId?: string;
  stage?: "session" | "search" | "candidate_evaluation" | "track" | "job";
  trackIndex?: number;
  durationMs: number;
  outcome?: "success" | "error";
  operation?: AppleApiRequestMetric["operation"];
  attempt?: number;
  status?: number;
  processedTracks?: number;
  requestCount?: number;
  retryCount?: number;
};

export type AppleMatchExecutionOptions = {
  concurrency?: number;
  logger?: (event: AppleMatchLogEvent) => void;
  sessionFactory?: (options: AppleApiSessionOptions) => Promise<AppleApiSession>;
};

function requestFailedResult(
  track: NormalizedTrack,
  error: unknown,
  operation: "session" | "search",
  attempts?: number
): AppleMatchResult {
  const { reason, requestFailure } = describeAppleRequestFailure(error, { operation, attempts });
  return {
    track,
    status: "request_failed",
    candidates: [],
    reason,
    requestFailure
  };
}

function defaultMatchLogger(event: AppleMatchLogEvent): void {
  process.stderr.write(`[apple-match] ${JSON.stringify(event)}\n`);
}

function safeLogger(logger: (event: AppleMatchLogEvent) => void): (event: AppleMatchLogEvent) => void {
  return (event) => {
    try {
      logger(event);
    } catch {
      // Diagnostics must never change matching behavior.
    }
  };
}

function durationSince(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

const JAPANESE_CHARACTER_RE = /[\u3005\u3006\u303b\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/u;

function containsOnlyAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

export function containsJapaneseCharacters(value: string): boolean {
  return !containsOnlyAscii(value) && JAPANESE_CHARACTER_RE.test(value);
}

function buildSearchTerm(track: NormalizedTrack): string {
  return [track.originalName, ...track.artists]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function storefrontForSearchTerm(searchTerm: string, accountStore: string): string {
  return containsJapaneseCharacters(searchTerm) ? "jp" : accountStore;
}

function apiSessionOptions(
  prefs: MatchPreferences,
  onRequest?: AppleApiSessionOptions["onRequest"]
): AppleApiSessionOptions {
  return {
    requestTimeoutMs: prefs.appleRequestTimeoutMs,
    minRequestIntervalMs: prefs.appleRequestIntervalMs,
    maxAttempts: DEFAULT_MATCH_PREFERENCES.appleMaxAttempts,
    baseRetryDelayMs: prefs.appleRetryBaseDelayMs,
    randomPauseEnabled: prefs.appleRandomPauseEnabled,
    randomPauseMinMs: prefs.appleRandomPauseMinMs,
    randomPauseMaxMs: prefs.appleRandomPauseMaxMs,
    onRequest
  };
}

function buildArtworkUrl(song: AppleSong): string | undefined {
  const art = song.attributes.artwork;
  if (!art?.url) return undefined;
  // Apple artwork URLs are templates with {w}/{h} placeholders.
  return art.url.replace("{w}", "200").replace("{h}", "200");
}

function normalizeTrackTitleMetadata(track: NormalizedTrack): NormalizedTrack {
  const metadata = normalizeTitleMetadata(track.originalName, track.artists);
  return {
    ...track,
    originalName: metadata.title,
    artists: metadata.artists,
    albumName: normalizeAlbumMetadata(track.albumName)
  };
}

function toCandidate(song: AppleSong, track: NormalizedTrack, storefront: string): AppleCandidate {
  const metadata = normalizeTitleMetadata(song.attributes.name, [song.attributes.artistName]);
  const albumName = normalizeAlbumMetadata(song.attributes.albumName);
  const albumDistance = track.albumName && albumName ? albumLevenshteinDistance(track.albumName, albumName) : undefined;
  return {
    id: song.id,
    name: metadata.title,
    artistName: metadata.artists.join(", "),
    albumName,
    url: song.attributes.url,
    artworkUrl: buildArtworkUrl(song),
    durationMs: song.attributes.durationInMillis,
    releaseDate: song.attributes.releaseDate,
    contentRating: song.attributes.contentRating,
    titleDistance: titleLevenshteinDistance(track.originalName, metadata.title),
    albumDistance,
    isrc: song.attributes.isrc,
    storefront
  };
}

function compareCandidates(left: AppleCandidate, right: AppleCandidate): number {
  const titleDifference = left.titleDistance - right.titleDistance;
  if (titleDifference !== 0) return titleDifference;

  if (left.albumDistance === undefined) {
    return right.albumDistance === undefined ? 0 : 1;
  }
  if (right.albumDistance === undefined) return -1;
  return left.albumDistance - right.albumDistance;
}

function candidateToSong(candidate: AppleCandidate): AppleSong {
  return {
    id: candidate.id,
    type: "songs",
    attributes: {
      name: candidate.name,
      artistName: candidate.artistName,
      albumName: candidate.albumName ?? "",
      durationInMillis: candidate.durationMs,
      releaseDate: candidate.releaseDate,
      isrc: candidate.isrc,
      url: candidate.url,
      contentRating: candidate.contentRating,
      artwork: candidate.artworkUrl ? { url: candidate.artworkUrl } : undefined
    }
  };
}

function resultChanged(previous: AppleMatchResult, next: AppleMatchResult): boolean {
  if (previous.status !== next.status) return true;
  if (previous.selectedId !== next.selectedId) return true;
  if (previous.appleMusicId !== next.appleMusicId) return true;
  if (previous.reason !== next.reason) return true;
  if (previous.sameTrack !== next.sameTrack) return true;

  const previousCandidates = previous.candidates ?? [];
  const nextCandidates = next.candidates ?? [];
  if (previousCandidates.length !== nextCandidates.length) return true;

  return nextCandidates.some((candidate, index) => {
    const previousCandidate = previousCandidates[index];
    return (
      previousCandidate.id !== candidate.id ||
      previousCandidate.titleDistance !== candidate.titleDistance ||
      previousCandidate.albumDistance !== candidate.albumDistance
    );
  });
}

function shouldRefreshExistingCandidates(result: AppleMatchResult): result is AppleMatchResult & {
  candidates: AppleCandidate[];
} {
  if (result.selectionSource === "manual") return false;
  if (!result.candidates || result.candidates.length === 0) return false;
  return result.status === "ambiguous" || result.status === "not_found";
}

function matchedResult(
  track: NormalizedTrack,
  candidates: AppleCandidate[],
  winner: AppleCandidate,
  sameTrack: boolean,
  reason?: string
): AppleMatchResult {
  return {
    track,
    status: "matched",
    candidates,
    selectedId: winner.id,
    selectionSource: "auto",
    appleMusicId: winner.id,
    appleMusicUrl: winner.url,
    ...(sameTrack ? { sameTrack: true } : {}),
    reason
  };
}

/**
 * Sort Apple Music search results by title distance, then by album distance.
 * Only an exact normalized title match is automatic; a different album is
 * marked as the same track.
 */
export async function matchSingleTrack(
  track: NormalizedTrack,
  results: AppleSong[],
  storefront: string
): Promise<AppleMatchResult> {
  const normalizedTrack = normalizeTrackTitleMetadata(track);
  if (results.length === 0) {
    return {
      track: normalizedTrack,
      status: "not_found",
      candidates: [],
      reason: "No results from Apple Music search"
    };
  }

  const candidates = results.map((song) => toCandidate(song, normalizedTrack, storefront)).sort(compareCandidates);
  const winner = candidates[0];

  if (winner.titleDistance !== 0) {
    return {
      track: normalizedTrack,
      status: "not_found",
      candidates,
      reason: `Closest candidate title distance ${winner.titleDistance}; exact title match required`
    };
  }

  const sameTrack = winner.albumDistance !== undefined && winner.albumDistance !== 0;
  return matchedResult(
    normalizedTrack,
    candidates,
    winner,
    sameTrack,
    sameTrack
      ? `Selected exact-title candidate with different album (distance ${winner.albumDistance})`
      : "Selected exact-title candidate"
  );
}

/**
 * Match one track: search by song title and artists, then rank the returned
 * candidates by title Levenshtein distance and album-distance tie-breaker.
 */
async function processTrack(
  track: NormalizedTrack,
  trackIndex: number,
  accountStore: string,
  session: AppleApiSession,
  logger: (event: AppleMatchLogEvent) => void,
  jobId: string | undefined
): Promise<AppleMatchResult> {
  const normalizedTrack = normalizeTrackTitleMetadata(track);
  const searchStartedAt = performance.now();
  const searchTerm = buildSearchTerm(normalizedTrack);
  const searchStorefront = storefrontForSearchTerm(searchTerm, accountStore);
  const songs = await session.search(searchTerm, searchStorefront);
  logger({
    event: "stage",
    jobId,
    stage: "search",
    trackIndex,
    durationMs: durationSince(searchStartedAt),
    outcome: "success"
  });

  const evaluationStartedAt = performance.now();
  const result = await matchSingleTrack(normalizedTrack, songs, searchStorefront);
  logger({
    event: "stage",
    jobId,
    stage: "candidate_evaluation",
    trackIndex,
    durationMs: durationSince(evaluationStartedAt),
    outcome: "success"
  });

  return result;
}

/**
 * Match all tracks in a playlist against the Apple Music catalog.
 * Requires Apple Music login (cookies).
 *
 * `prefs` tunes request pacing and storefront selection. `onProgress`
 * (optional) is invoked after each track so a caller can surface live progress.
 */
export async function matchAppleMusic(
  playlist: NormalizedPlaylist,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void,
  execution: AppleMatchExecutionOptions = {}
): Promise<AppleMatchReport> {
  if (!execution.sessionFactory) {
    const cookies = await loadCookies("apple");
    if (!cookies || cookies.length === 0) {
      return {
        provider: playlist.provider,
        playlistId: playlist.id,
        playlistName: playlist.name,
        results: playlist.tracks.map((track) => ({
          track,
          status: "not_implemented",
          reason: "Not logged in to Apple Music. Please log in from Settings."
        }))
      };
    }
  }

  const logger = safeLogger(execution.logger ?? defaultMatchLogger);
  const sessionFactory = execution.sessionFactory ?? createAppleApiSession;
  const jobStartedAt = performance.now();
  const jobId = playlist.id;
  let session: AppleApiSession;
  let sessionAttempts = 0;
  const sessionStartedAt = performance.now();
  try {
    const options = apiSessionOptions(prefs, (metric) => {
      logger({
        event: "request",
        jobId,
        durationMs: Math.round(metric.durationMs * 100) / 100,
        operation: metric.operation,
        attempt: metric.attempt,
        outcome: metric.outcome,
        status: metric.status
      });
    });
    session = await runWithRetry(
      async () => {
        sessionAttempts += 1;
        return sessionFactory(options);
      },
      {
        maxAttempts: DEFAULT_MATCH_PREFERENCES.appleMaxAttempts,
        shouldRetry: () => true
      }
    );
    logger({
      event: "stage",
      jobId,
      stage: "session",
      durationMs: durationSince(sessionStartedAt),
      outcome: "success"
    });
  } catch (error) {
    logger({
      event: "stage",
      jobId,
      stage: "session",
      durationMs: durationSince(sessionStartedAt),
      outcome: "error"
    });
    return {
      provider: playlist.provider,
      playlistId: playlist.id,
      playlistName: playlist.name,
      results: playlist.tracks.map((track) => ({
        ...requestFailedResult(track, error, "session", sessionAttempts)
      }))
    };
  }

  try {
    let accountStore = prefs.storefront.trim();
    if (!accountStore) {
      try {
        accountStore = await session.getStorefront();
      } catch {
        accountStore = "us";
      }
    }

    const total = playlist.tracks.length;
    const results = await mapWithConcurrency(
      playlist.tracks,
      execution.concurrency ?? prefs.matchConcurrency,
      async (track, trackIndex): Promise<AppleMatchResult> => {
        const trackStartedAt = performance.now();
        let outcome: "success" | "error" = "success";
        try {
          return await processTrack(track, trackIndex, accountStore, session, logger, jobId);
        } catch (error) {
          outcome = "error";
          return requestFailedResult(track, error, "search");
        } finally {
          logger({
            event: "stage",
            jobId,
            stage: "track",
            trackIndex,
            durationMs: durationSince(trackStartedAt),
            outcome
          });
        }
      },
      (result, _index, completed) => {
        onProgress?.(completed, total, result);
      }
    );

    return {
      provider: playlist.provider,
      playlistId: playlist.id,
      playlistName: playlist.name,
      results
    };
  } finally {
    await session.close();
    const stats = session.getStats();
    logger({
      event: "job_complete",
      jobId,
      stage: "job",
      durationMs: durationSince(jobStartedAt),
      processedTracks: playlist.tracks.length,
      requestCount: stats.requestCount,
      retryCount: stats.retryCount
    });
  }
}

/**
 * Re-run Apple Music matching only for results currently marked not_found,
 * including manual "no match" rows, then merge those refreshed results back
 * into the existing report.
 */
export async function retryNotFoundAppleMusic(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void,
  execution: AppleMatchExecutionOptions = {}
): Promise<AppleMatchReport> {
  return retryAppleMusicResults(report, getNotFoundIndices(report.results), prefs, onProgress, execution);
}

export async function retryAppleMusicResults(
  report: AppleMatchReport,
  indices: readonly number[],
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES,
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void,
  execution: AppleMatchExecutionOptions = {}
): Promise<AppleMatchReport> {
  const retryIndices = Array.from(new Set(indices)).filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < report.results.length
  );
  if (retryIndices.length === 0) {
    return report;
  }

  const retryPlaylist: NormalizedPlaylist = {
    provider: report.provider,
    id: report.playlistId,
    name: report.playlistName,
    tracks: retryIndices.map((idx) => report.results[idx].track),
    raw: {}
  };
  const retryReport = await matchAppleMusic(retryPlaylist, prefs, onProgress, execution);
  const results = report.results.slice();
  for (const [pos, idx] of retryIndices.entries()) {
    const next = retryReport.results[pos];
    if (next) {
      results[idx] = next;
    }
  }

  return {
    ...report,
    results
  };
}

/**
 * Re-sort candidates in legacy ambiguous / not-found results by title and album
 * distance, then merge any changed results back into the report.
 */
export async function refreshAppleMatchReportCandidates(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES
): Promise<AppleMatchReport> {
  const results: AppleMatchResult[] = [];
  let changed = false;

  for (const result of report.results) {
    if (!shouldRefreshExistingCandidates(result)) {
      results.push(result);
      continue;
    }

    try {
      const storefront = result.candidates.find((candidate) => candidate.storefront)?.storefront ?? prefs.storefront;
      const songs = result.candidates.map(candidateToSong);
      const refreshed = await matchSingleTrack(result.track, songs, storefront || "us");
      results.push(refreshed);
      changed ||= resultChanged(result, refreshed);
    } catch {
      results.push(result);
    }
  }

  return changed ? { ...report, results } : report;
}

/**
 * Collect the addable catalog ids of every matched result. With no cross-store
 * bridging, the selected candidate id is already the id that can be added to
 * the user's library.
 */
export function resolveAppleMusicTrackIds(report: AppleMatchReport): string[] {
  return report.results
    .filter((result) => result.status === "matched")
    .map((result) => {
      const selected = result.candidates?.find((candidate) => candidate.id === result.selectedId);
      return selected?.id ?? result.appleMusicId;
    })
    .filter((id): id is string => Boolean(id));
}

/**
 * Create an Apple Music playlist from matched tracks.
 */
export async function createAppleMusicPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  return appleCreatePlaylist(name, description, trackIds);
}

export async function createAppleMusicPlaylistFromReport(
  report: AppleMatchReport,
  prefs: MatchPreferences,
  name: string,
  description: string,
  execution: AppleMatchExecutionOptions = {}
): Promise<string> {
  const sessionFactory = execution.sessionFactory ?? createAppleApiSession;
  const session = await sessionFactory(apiSessionOptions(prefs));
  try {
    const trackIds = resolveAppleMusicTrackIds(report);
    if (trackIds.length === 0) {
      throw new Error("No matched tracks to add to playlist");
    }
    return session.createPlaylist(name, description, trackIds);
  } finally {
    await session.close();
  }
}
