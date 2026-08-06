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
import { scoreAppleSong } from "./scoring.js";

/** Number of candidates kept per track so the user can override the pick. */
const MAX_CANDIDATES = 8;

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
  operation: "session" | "search"
): AppleMatchResult {
  const { reason, requestFailure } = describeAppleRequestFailure(error, { operation });
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

function apiSessionOptions(
  prefs: MatchPreferences,
  onRequest?: AppleApiSessionOptions["onRequest"]
): AppleApiSessionOptions {
  return {
    requestTimeoutMs: prefs.appleRequestTimeoutMs,
    minRequestIntervalMs: prefs.appleRequestIntervalMs,
    maxAttempts: prefs.appleMaxAttempts,
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

function toCandidate(
  song: AppleSong,
  scoreBreakdown: ReturnType<typeof scoreAppleSong>,
  storefront: string
): AppleCandidate {
  return {
    id: song.id,
    name: song.attributes.name,
    artistName: song.attributes.artistName,
    albumName: song.attributes.albumName,
    url: song.attributes.url,
    artworkUrl: buildArtworkUrl(song),
    durationMs: song.attributes.durationInMillis,
    releaseDate: song.attributes.releaseDate,
    contentRating: song.attributes.contentRating,
    score: scoreBreakdown.total,
    scoreBreakdown,
    isrc: song.attributes.isrc,
    storefront
  };
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

  const previousCandidates = previous.candidates ?? [];
  const nextCandidates = next.candidates ?? [];
  if (previousCandidates.length !== nextCandidates.length) return true;

  return nextCandidates.some((candidate, index) => {
    const previousCandidate = previousCandidates[index];
    return (
      previousCandidate.id !== candidate.id ||
      previousCandidate.score !== candidate.score ||
      previousCandidate.scoreBreakdown?.total !== candidate.scoreBreakdown?.total
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

/** Ordering preference for explicit/clean when scores are otherwise equal. */
function explicitRank(candidate: AppleCandidate, prefs: MatchPreferences): number {
  if (prefs.explicitPreference === "none") return 0;
  if (prefs.explicitPreference === "explicit") {
    return candidate.contentRating === "explicit" ? 1 : 0;
  }
  // prefer clean
  return candidate.contentRating === "clean" ? 1 : 0;
}

function matchedResult(
  track: NormalizedTrack,
  candidates: AppleCandidate[],
  winner: AppleCandidate,
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
    reason
  };
}

/**
 * Score every search result, then decide a status by score alone:
 * - no results, or best below `threshold` → `not_found`
 * - otherwise → `matched` (best)
 *
 * Candidates are ranked by score (with the explicit/clean preference as a
 * deterministic ordering hint for equal scores).
 */
export async function matchSingleTrack(
  track: NormalizedTrack,
  results: AppleSong[],
  storefront: string,
  prefs: MatchPreferences
): Promise<AppleMatchResult> {
  if (results.length === 0) {
    return { track, status: "not_found", candidates: [], reason: "No results from Apple Music search" };
  }

  const candidates = results.map((song) => toCandidate(song, scoreAppleSong(track, song, prefs), storefront));
  const ranked = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return explicitRank(b, prefs) - explicitRank(a, prefs);
  });
  const scored = ranked.slice(0, MAX_CANDIDATES);

  const best = scored[0];

  if (best.score < prefs.threshold) {
    return {
      track,
      status: "not_found",
      candidates: scored,
      reason: `Best match score ${best.score.toFixed(2)} below threshold ${prefs.threshold.toFixed(2)}`
    };
  }

  return matchedResult(track, scored, best, `Selected best match (score ${best.score.toFixed(2)})`);
}

/**
 * Match one track: search the account storefront by song title, score the
 * candidates, and pick the best match.
 */
async function processTrack(
  track: NormalizedTrack,
  trackIndex: number,
  accountStore: string,
  prefs: MatchPreferences,
  session: AppleApiSession,
  logger: (event: AppleMatchLogEvent) => void,
  jobId: string | undefined
): Promise<AppleMatchResult> {
  const searchStartedAt = performance.now();
  const songs = await session.search(track.originalName, accountStore);
  logger({
    event: "stage",
    jobId,
    stage: "search",
    trackIndex,
    durationMs: durationSince(searchStartedAt),
    outcome: "success"
  });

  const evaluationStartedAt = performance.now();
  const result = await matchSingleTrack(track, songs, accountStore, prefs);
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
 * `prefs` tunes thresholds and request pacing. `onProgress` (optional) is
 * invoked after each track so a caller can surface live progress.
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
  const sessionStartedAt = performance.now();
  try {
    session = await sessionFactory(
      apiSessionOptions(prefs, (metric) => {
        logger({
          event: "request",
          jobId,
          durationMs: Math.round(metric.durationMs * 100) / 100,
          operation: metric.operation,
          attempt: metric.attempt,
          outcome: metric.outcome,
          status: metric.status
        });
      })
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
        ...requestFailedResult(track, error, "session")
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
          return await processTrack(track, trackIndex, accountStore, prefs, session, logger, jobId);
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
 * Re-score the candidates of legacy ambiguous / not-found results (e.g. after
 * a preference change) and merge any changed results back into the report.
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
      const refreshed = await matchSingleTrack(result.track, songs, storefront || "us", prefs);
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
