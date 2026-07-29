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
import {
  type ArtworkComparator,
  type ArtworkComparatorOptions,
  type CandidateSimilarity,
  chooseByCoverSimilarity,
  createArtworkComparator
} from "./artwork.js";
import { mapWithConcurrency } from "./concurrency.js";
import { describeAppleRequestFailure } from "./requestFailure.js";
import { albumSimilarity, compactAlbumText, compactText, scoreAppleSong } from "./scoring.js";

/** Number of candidates kept per track so the user can override the pick. */
const MAX_CANDIDATES = 8;

export type AppleMatchLogEvent = {
  event: "request" | "stage" | "job_complete";
  jobId?: string;
  stage?: "session" | "search" | "candidate_evaluation" | "artwork" | "isrc" | "track" | "job";
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
  artworkComparatorFactory?: (options: ArtworkComparatorOptions) => ArtworkComparator;
};

type CoverSimilarityChooser = (
  track: NormalizedTrack,
  candidates: AppleCandidate[]
) => Promise<CandidateSimilarity | undefined>;

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

/**
 * Pick the Apple Music storefront whose catalog best holds a track's original
 * text, so non-English tracks are searched (and scored) in their native script
 * rather than the account store's romanized metadata. Returns undefined when no
 * native region applies (Latin text) — the caller then uses the account store.
 */
export function detectStorefrontForTrack(
  track: NormalizedTrack,
  mode: MatchPreferences["cjkDetection"]
): string | undefined {
  const text = `${track.originalName} ${track.artists.join(" ")} ${track.albumName ?? ""}`;
  const hasKana = /[぀-ゟ゠-ヿ]/u.test(text); // Hiragana / Katakana
  const hasHangul = /[가-힯ᄀ-ᇿ]/u.test(text);
  const hasHan = /[一-鿿㐀-䶿]/u.test(text);

  if (hasHangul) return "kr";
  if (hasKana) return "jp";
  if (hasHan) {
    if (mode === "source") {
      // Chinese providers → Chinese store; otherwise Han-only is usually Japanese.
      return track.source.provider === "qq" || track.source.provider === "netease" ? "cn" : "jp";
    }
    // Pure text mode: Han-only most commonly indicates Japanese kanji titles.
    return "jp";
  }
  return undefined;
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

function mergePreservedCandidateFields(
  refreshed: AppleMatchResult,
  previousCandidates: AppleCandidate[]
): AppleMatchResult {
  if (!refreshed.candidates) {
    return refreshed;
  }

  const previousById = new Map(previousCandidates.map((candidate) => [candidate.id, candidate]));
  const candidates = refreshed.candidates.map((candidate) => {
    const previous = previousById.get(candidate.id);
    return previous
      ? {
          ...candidate,
          addableId: previous.addableId,
          artworkUrl: previous.artworkUrl ?? candidate.artworkUrl,
          storefront: previous.storefront ?? candidate.storefront
        }
      : candidate;
  });
  const selected = refreshed.selectedId
    ? candidates.find((candidate) => candidate.id === refreshed.selectedId)
    : undefined;

  return {
    ...refreshed,
    candidates,
    appleMusicId: selected?.addableId ?? refreshed.appleMusicId,
    appleMusicUrl: selected?.url ?? refreshed.appleMusicUrl
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

/** Tie-break preference for explicit/clean when scores are otherwise equal. */
function explicitRank(candidate: AppleCandidate, prefs: MatchPreferences): number {
  if (prefs.explicitPreference === "none") return 0;
  if (prefs.explicitPreference === "explicit") {
    return candidate.contentRating === "explicit" ? 1 : 0;
  }
  // prefer clean
  return candidate.contentRating === "clean" ? 1 : 0;
}

function hasEquivalentDuration(left: AppleCandidate, right: AppleCandidate): boolean {
  if (!left.durationMs || !right.durationMs) {
    return left.durationMs === right.durationMs;
  }
  return Math.abs(left.durationMs - right.durationMs) <= 2_000;
}

function isEquivalentCandidate(left: AppleCandidate, right: AppleCandidate): boolean {
  return (
    compactText(left.name) === compactText(right.name) &&
    compactText(left.artistName) === compactText(right.artistName) &&
    compactAlbumText(left.albumName ?? "") === compactAlbumText(right.albumName ?? "") &&
    hasEquivalentDuration(left, right)
  );
}

function matchesSourceAlbum(track: NormalizedTrack, candidate: AppleCandidate): boolean {
  const sourceAlbum = compactAlbumText(track.albumName ?? "");
  return Boolean(sourceAlbum) && compactAlbumText(candidate.albumName ?? "") === sourceAlbum;
}

function chooseIndistinguishableDuplicate(
  track: NormalizedTrack,
  candidates: AppleCandidate[]
): AppleCandidate | undefined {
  const best = candidates[0];
  if (!best || candidates.length < 2) return undefined;
  if (!candidates.every((candidate) => matchesSourceAlbum(track, candidate))) return undefined;
  return candidates.every((candidate) => isEquivalentCandidate(best, candidate)) ? best : undefined;
}

function chooseByAlbumSimilarity(
  track: NormalizedTrack,
  candidates: AppleCandidate[]
): { candidate: AppleCandidate; similarity: number } | undefined {
  const sourceAlbum = compactAlbumText(track.albumName ?? "");
  if (!sourceAlbum) return undefined;

  let candidate = candidates[0];
  let similarity = candidate.scoreBreakdown?.fields.album ?? albumSimilarity(track.albumName, candidate.albumName);

  for (const current of candidates.slice(1)) {
    const currentSimilarity =
      current.scoreBreakdown?.fields.album ?? albumSimilarity(track.albumName, current.albumName);
    if (currentSimilarity > similarity || (currentSimilarity === similarity && current.score > candidate.score)) {
      candidate = current;
      similarity = currentSimilarity;
    }
  }

  return { candidate, similarity };
}

function chooseByDurationSimilarity(candidates: AppleCandidate[]): AppleCandidate | undefined {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      durationScore: candidate.scoreBreakdown?.fields.duration ?? 0,
      titleScore: candidate.scoreBreakdown?.fields.title ?? 0,
      artistScore: candidate.scoreBreakdown?.fields.artist ?? 0,
      versionScore: candidate.scoreBreakdown?.fields.version ?? 0
    }))
    .sort((a, b) => b.durationScore - a.durationScore);

  const best = scored[0];
  const second = scored[1];
  if (!best || !second) return undefined;
  if (best.durationScore < 0.95) return undefined;
  if (best.durationScore - second.durationScore < 0.5) return undefined;
  if (best.titleScore < 0.8 || best.artistScore < 0.5) return undefined;
  if (best.versionScore < 0.8) return undefined;
  return best.candidate;
}

function scoreGapReason(best: AppleCandidate, second: AppleCandidate | undefined, prefs: MatchPreferences): string {
  if (!second) {
    return `score ${best.score.toFixed(2)}`;
  }

  const gap = best.score - second.score;
  return `best ${best.score.toFixed(2)} vs second ${second.score.toFixed(2)}; gap ${gap.toFixed(2)} / required ${prefs.ambiguousGap.toFixed(2)}`;
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

function sharedRecordingIsrc(candidates: AppleCandidate[]): string | undefined {
  const isrc = candidates[0].isrc;
  return isrc && candidates.every((candidate) => candidate.isrc === isrc) ? isrc : undefined;
}

function retainCandidates(ranked: AppleCandidate[], winner: AppleCandidate): AppleCandidate[] {
  const retained = ranked.slice(0, MAX_CANDIDATES);
  if (retained.some((candidate) => candidate.id === winner.id)) {
    return retained;
  }
  return [...retained.slice(0, MAX_CANDIDATES - 1), winner];
}

export async function matchSingleTrack(
  track: NormalizedTrack,
  results: AppleSong[],
  storefront: string,
  prefs: MatchPreferences,
  chooseCover: CoverSimilarityChooser = chooseByCoverSimilarity
): Promise<AppleMatchResult> {
  if (results.length === 0) {
    return { track, status: "not_found", candidates: [], reason: "No results from Apple Music search" };
  }

  const searchOrderCandidates = results.map((song) => {
    const scoreBreakdown = scoreAppleSong(track, song, prefs);
    return toCandidate(song, scoreBreakdown, storefront);
  });
  const ranked = [...searchOrderCandidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Equal score → apply explicit/clean preference as a tie-break.
    return explicitRank(b, prefs) - explicitRank(a, prefs);
  });
  const scored = ranked.slice(0, MAX_CANDIDATES);

  const best = scored[0];

  if (best.score < prefs.threshold) {
    const durationChoice = chooseByDurationSimilarity(scored);
    if (
      durationChoice &&
      best.score - durationChoice.score < prefs.ambiguousGap &&
      durationChoice.score >= Math.max(0.75, prefs.threshold - 0.1)
    ) {
      const durationScore = durationChoice.scoreBreakdown?.fields.duration ?? 0;
      return matchedResult(
        track,
        scored,
        durationChoice,
        `Selected by duration-backed version match (${durationScore.toFixed(2)}; score ${durationChoice.score.toFixed(2)} below threshold ${prefs.threshold.toFixed(2)} but title/artist/version agree)`
      );
    }

    return {
      track,
      status: "not_found",
      candidates: scored,
      reason: `Best match score ${best.score.toFixed(2)} below threshold ${prefs.threshold.toFixed(2)} (${scoreGapReason(best, scored[1], prefs)})`
    };
  }

  const eligible = searchOrderCandidates.filter((candidate) => candidate.score >= prefs.threshold);
  const duplicateChoice = chooseIndistinguishableDuplicate(track, eligible);
  if (duplicateChoice) {
    return matchedResult(
      track,
      retainCandidates(ranked, duplicateChoice),
      duplicateChoice,
      `Selected first indistinguishable duplicate (${scoreGapReason(best, scored[1], prefs)})`
    );
  }

  const albumChoice = chooseByAlbumSimilarity(track, eligible);
  if (albumChoice) {
    return matchedResult(
      track,
      retainCandidates(ranked, albumChoice.candidate),
      albumChoice.candidate,
      `Selected by album match using album similarity (${albumChoice.similarity.toFixed(2)})`
    );
  }

  const second = scored[1];
  const isTie = second !== undefined && best.score - second.score < prefs.ambiguousGap;

  if (isTie) {
    // Try to break the tie decisively with the explicit/clean preference.
    const bestRank = explicitRank(best, prefs);
    const secondRank = explicitRank(second, prefs);
    if (prefs.explicitPreference !== "none" && bestRank !== secondRank) {
      const winner = bestRank > secondRank ? best : second;
      return matchedResult(
        track,
        scored,
        winner,
        `Selected by explicit/clean preference (${scoreGapReason(best, second, prefs)})`
      );
    }

    const nearTied = scored.filter((candidate) => best.score - candidate.score < prefs.ambiguousGap);
    const sharedIsrc = sharedRecordingIsrc(nearTied);
    if (sharedIsrc) {
      return matchedResult(track, scored, best, `Equivalent releases share ISRC ${sharedIsrc}`);
    }

    const durationChoice = chooseByDurationSimilarity(nearTied);
    if (durationChoice) {
      const durationScore = durationChoice.scoreBreakdown?.fields.duration ?? 0;
      return matchedResult(
        track,
        scored,
        durationChoice,
        `Selected by duration match (${durationScore.toFixed(2)}; ${scoreGapReason(best, second, prefs)})`
      );
    }

    const coverChoice = await chooseCover(track, nearTied);
    if (coverChoice) {
      return matchedResult(
        track,
        scored,
        coverChoice.candidate,
        `Selected by album cover similarity (${coverChoice.similarity.toFixed(2)}; ${scoreGapReason(best, second, prefs)})`
      );
    }

    return {
      track,
      status: "ambiguous",
      candidates: scored,
      reason: `Multiple close matches (${scoreGapReason(best, second, prefs)}); no decisive explicit, album, duration, or cover tie-breaker`
    };
  }

  return matchedResult(track, scored, best, `Selected best match (${scoreGapReason(best, second, prefs)})`);
}

async function resolveCandidateId(
  candidate: AppleCandidate,
  accountStore: string,
  session: AppleApiSession
): Promise<string> {
  if (candidate.addableId) {
    return candidate.addableId;
  }
  if (!candidate.storefront || candidate.storefront === accountStore) {
    candidate.addableId = candidate.id;
    return candidate.id;
  }
  if (!candidate.isrc) {
    return candidate.id;
  }

  try {
    const matches = await session.songsByIsrc(candidate.isrc, accountStore);
    if (matches.length > 0) {
      candidate.addableId = matches[0].id;
      return candidate.addableId;
    }
  } catch {
    // Bridging is best-effort. Playlist creation retains the existing fallback.
  }
  return candidate.id;
}

/**
 * Match one track: search its native store (when nativeSearch is on and the
 * track's script implies a non-account region), score there, then bridge the
 * candidates back to the account store via ISRC so they can be added to the
 * user's library.
 */
async function processTrack(
  track: NormalizedTrack,
  trackIndex: number,
  accountStore: string,
  prefs: MatchPreferences,
  session: AppleApiSession,
  artworkComparator: ArtworkComparator,
  logger: (event: AppleMatchLogEvent) => void,
  jobId: string | undefined
): Promise<AppleMatchResult> {
  const query = `${track.originalName} ${track.artists[0] ?? ""}`.trim();
  const nativeStore = prefs.nativeSearch ? detectStorefrontForTrack(track, prefs.cjkDetection) : undefined;
  const searchStore = nativeStore && nativeStore !== accountStore ? nativeStore : accountStore;

  const searchStartedAt = performance.now();
  const songs = await session.search(query, searchStore);
  logger({
    event: "stage",
    jobId,
    stage: "search",
    trackIndex,
    durationMs: durationSince(searchStartedAt),
    outcome: "success"
  });

  const evaluationStartedAt = performance.now();
  const result = await matchSingleTrack(track, songs, searchStore, prefs, async (sourceTrack, candidates) => {
    const artworkStartedAt = performance.now();
    try {
      return await artworkComparator.choose(sourceTrack, candidates);
    } catch {
      return undefined;
    } finally {
      logger({
        event: "stage",
        jobId,
        stage: "artwork",
        trackIndex,
        durationMs: durationSince(artworkStartedAt)
      });
    }
  });
  logger({
    event: "stage",
    jobId,
    stage: "candidate_evaluation",
    trackIndex,
    durationMs: durationSince(evaluationStartedAt),
    outcome: "success"
  });

  if (result.selectedId && result.candidates) {
    const selected = result.candidates.find((candidate) => candidate.id === result.selectedId);
    if (selected) {
      if (searchStore === accountStore) {
        selected.addableId = selected.id;
      } else {
        const isrcStartedAt = performance.now();
        result.appleMusicId = await resolveCandidateId(selected, accountStore, session);
        logger({
          event: "stage",
          jobId,
          stage: "isrc",
          trackIndex,
          durationMs: durationSince(isrcStartedAt),
          outcome: selected.addableId ? "success" : "error"
        });
      }
    }
  }

  return result;
}

/**
 * Match all tracks in a playlist against the Apple Music catalog.
 * Requires Apple Music login (cookies).
 *
 * `prefs` tunes thresholds, tie-break rules, and native-region search.
 * `onProgress` (optional) is invoked after each track so a caller can surface
 * live progress.
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
  const artworkComparatorFactory = execution.artworkComparatorFactory ?? createArtworkComparator;
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

  const artworkComparator = artworkComparatorFactory({ timeoutMs: prefs.artworkTimeoutMs });
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
          return await processTrack(track, trackIndex, accountStore, prefs, session, artworkComparator, logger, jobId);
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
    await Promise.allSettled([artworkComparator.close(), session.close()]);
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

export async function refreshAppleMatchReportCandidates(
  report: AppleMatchReport,
  prefs: MatchPreferences = DEFAULT_MATCH_PREFERENCES
): Promise<AppleMatchReport> {
  const results: AppleMatchResult[] = [];
  let changed = false;
  const artworkComparator = createArtworkComparator({ timeoutMs: prefs.artworkTimeoutMs });

  try {
    for (const result of report.results) {
      if (!shouldRefreshExistingCandidates(result)) {
        results.push(result);
        continue;
      }

      try {
        const storefront = result.candidates.find((candidate) => candidate.storefront)?.storefront ?? prefs.storefront;
        const songs = result.candidates.map(candidateToSong);
        const refreshed = mergePreservedCandidateFields(
          await matchSingleTrack(result.track, songs, storefront || "us", prefs, (track, candidates) =>
            artworkComparator.choose(track, candidates)
          ),
          result.candidates
        );
        results.push(refreshed);
        changed ||= resultChanged(result, refreshed);
      } catch {
        results.push(result);
      }
    }
  } finally {
    await artworkComparator.close();
  }

  return changed ? { ...report, results } : report;
}

export async function resolveAppleMusicTrackIds(
  report: AppleMatchReport,
  accountStore: string,
  session: AppleApiSession,
  concurrency = DEFAULT_MATCH_PREFERENCES.matchConcurrency
): Promise<string[]> {
  const matched = report.results.filter((result) => result.status === "matched");
  const resolved = await mapWithConcurrency(matched, concurrency, async (result) => {
    const selected = result.candidates?.find((candidate) => candidate.id === result.selectedId);
    if (!selected) {
      return result.appleMusicId;
    }

    const id = await resolveCandidateId(selected, accountStore, session);
    result.appleMusicId = id;
    return id;
  });
  return resolved.filter((id): id is string => Boolean(id));
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
    let accountStore = prefs.storefront.trim();
    if (!accountStore) {
      accountStore = await session.getStorefront().catch(() => "us");
    }
    const trackIds = await resolveAppleMusicTrackIds(
      report,
      accountStore,
      session,
      execution.concurrency ?? prefs.matchConcurrency
    );
    if (trackIds.length === 0) {
      throw new Error("No matched tracks to add to playlist");
    }
    return session.createPlaylist(name, description, trackIds);
  } finally {
    await session.close();
  }
}
