import { loadCookies } from "../fetchers/auth.js";
import {
  type AppleCandidate,
  type AppleMatchReport,
  type AppleMatchResult,
  DEFAULT_MATCH_PREFERENCES,
  type MatchPreferences,
  type NormalizedPlaylist,
  type NormalizedTrack
} from "../types.js";
import { type AppleSong, appleCreatePlaylist, appleGetStorefront, appleSearch, appleSongsByIsrc } from "./api.js";
import { chooseByCoverSimilarity } from "./artwork.js";

/** Number of candidates kept per track so the user can override the pick. */
const MAX_CANDIDATES = 8;

/** Tokens that indicate a non-original version (used by preferOriginalVersion). */
const VERSION_TOKENS = ["remaster", "remastered", "live", "karaoke", "instrumental", "cover", "version", "remix"];

type ScoredCandidate = AppleCandidate & { albumName: string };

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeAlbumText(s: string): string {
  return normalizeText(s.normalize("NFKC"));
}

function editDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous = current;
  }

  return previous[right.length];
}

function albumSimilarity(sourceAlbum: string, candidateAlbum: string): number {
  const source = normalizeAlbumText(sourceAlbum);
  const candidate = normalizeAlbumText(candidateAlbum);
  if (source === candidate) {
    return 1;
  }
  return 1 - editDistance(source, candidate) / Math.max(Array.from(source).length, Array.from(candidate).length);
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

function toCandidate(song: AppleSong, score: number, storefront: string): ScoredCandidate {
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
    score,
    isrc: song.attributes.isrc,
    storefront
  };
}

/**
 * Base text similarity between a track and an Apple song (name + artist).
 * Returns 0–1. Duration/version/explicit rules are applied on top of this.
 */
function baseScore(track: NormalizedTrack, song: AppleSong): number {
  const trackName = normalizeText(track.originalName);
  const songName = normalizeText(song.attributes.name);
  const trackArtist = normalizeText(track.artists[0] ?? "");
  const songArtist = normalizeText(song.attributes.artistName);

  let nameScore = 0;
  if (trackName === songName) {
    nameScore = 1;
  } else if (songName.includes(trackName) || trackName.includes(songName)) {
    nameScore = 0.7;
  }

  let artistScore = 0;
  if (trackArtist === songArtist) {
    artistScore = 1;
  } else if (songArtist.includes(trackArtist) || trackArtist.includes(songArtist)) {
    artistScore = 0.7;
  }

  return nameScore * 0.6 + artistScore * 0.4;
}

/**
 * Apply configurable rule bonuses/penalties to a base score. Kept small so text
 * similarity stays dominant; rules mainly break ties between close versions.
 */
function applyRules(base: number, track: NormalizedTrack, song: AppleSong, prefs: MatchPreferences): number {
  let score = base;

  // Duration closeness: up to +0.1 when within ~2s, fading to 0 by ~30s off.
  if (prefs.preferDurationMatch && track.durationMs && song.attributes.durationInMillis) {
    const diffSec = Math.abs(track.durationMs - song.attributes.durationInMillis) / 1000;
    const bonus = Math.max(0, 0.1 * (1 - diffSec / 30));
    score += bonus;
  }

  // Version type: penalize remaster/live/karaoke/etc. unless the source name
  // also carries that token (so a track literally titled "... (Live)" isn't hurt).
  if (prefs.preferOriginalVersion) {
    const songName = song.attributes.name.toLowerCase();
    const srcName = track.originalName.toLowerCase();
    const hasExtraVersion = VERSION_TOKENS.some((t) => songName.includes(t) && !srcName.includes(t));
    if (hasExtraVersion) {
      score -= 0.08;
    }
  }

  return score;
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

function matchedResult(track: NormalizedTrack, candidates: AppleCandidate[], winner: AppleCandidate): AppleMatchResult {
  return {
    track,
    status: "matched",
    candidates,
    selectedId: winner.id,
    selectionSource: "auto",
    appleMusicId: winner.id,
    appleMusicUrl: winner.url
  };
}

function sharedRecordingIsrc(candidates: AppleCandidate[]): string | undefined {
  const isrc = candidates[0].isrc;
  return isrc && candidates.every((candidate) => candidate.isrc === isrc) ? isrc : undefined;
}

function chooseByAlbumSimilarity(
  sourceAlbum: string,
  candidates: ScoredCandidate[]
): { candidate: ScoredCandidate; similarity: number } {
  let candidate = candidates[0];
  let similarity = albumSimilarity(sourceAlbum, candidate.albumName);

  for (const current of candidates.slice(1)) {
    const currentSimilarity = albumSimilarity(sourceAlbum, current.albumName);
    if (currentSimilarity > similarity || (currentSimilarity === similarity && current.score > candidate.score)) {
      candidate = current;
      similarity = currentSimilarity;
    }
  }

  return { candidate, similarity };
}

function retainCandidates(ranked: ScoredCandidate[], winner: ScoredCandidate): ScoredCandidate[] {
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
  prefs: MatchPreferences
): Promise<AppleMatchResult> {
  if (results.length === 0) {
    return { track, status: "not_found", candidates: [], reason: "No results from Apple Music search" };
  }

  const searchOrderCandidates = results.map((song) => {
    const score = applyRules(baseScore(track, song), track, song, prefs);
    return toCandidate(song, score, storefront);
  });
  const ranked = [...searchOrderCandidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Equal score → apply explicit/clean preference as a tie-break.
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

  if (track.albumName) {
    const eligible = searchOrderCandidates.filter((candidate) => candidate.score >= prefs.threshold);
    const albumChoice = chooseByAlbumSimilarity(track.albumName, eligible);
    const candidates = retainCandidates(ranked, albumChoice.candidate);
    return {
      ...matchedResult(track, candidates, albumChoice.candidate),
      reason: `Selected by album similarity (${albumChoice.similarity.toFixed(2)})`
    };
  }

  const second = scored[1];
  const isTie = second !== undefined && best.score - second.score < prefs.ambiguousGap;

  if (isTie) {
    // Try to break the tie decisively with the explicit/clean preference.
    const bestRank = explicitRank(best, prefs);
    const secondRank = explicitRank(second, prefs);
    if (prefs.explicitPreference !== "none" && bestRank !== secondRank) {
      const winner = bestRank > secondRank ? best : second;
      return matchedResult(track, scored, winner);
    }

    const nearTied = scored.filter((candidate) => best.score - candidate.score < prefs.ambiguousGap);
    const sharedIsrc = sharedRecordingIsrc(nearTied);
    if (sharedIsrc) {
      return {
        ...matchedResult(track, scored, best),
        reason: `Equivalent releases share ISRC ${sharedIsrc}`
      };
    }

    const coverChoice = await chooseByCoverSimilarity(track, nearTied);
    if (coverChoice) {
      return {
        ...matchedResult(track, scored, coverChoice.candidate),
        reason: `Selected by album cover similarity (${coverChoice.similarity.toFixed(2)})`
      };
    }

    return {
      track,
      status: "ambiguous",
      candidates: scored,
      reason: `Multiple close matches (${best.score.toFixed(2)} vs ${second.score.toFixed(2)})`
    };
  }

  return matchedResult(track, scored, best);
}

/**
 * Resolve the account-store (addable) id for each candidate via its ISRC, when
 * the candidate came from a different (native) store. Mutates candidates in
 * place, setting `addableId`. Best-effort: failures leave addableId undefined
 * and are tolerated (the candidate id is used as a fallback at creation time).
 */
async function bridgeCandidatesToAccountStore(candidates: AppleCandidate[], accountStore: string): Promise<void> {
  for (const c of candidates) {
    if (c.storefront === accountStore) {
      c.addableId = c.id;
      continue;
    }
    if (!c.isrc) continue;
    try {
      const matches = await appleSongsByIsrc(c.isrc, accountStore);
      if (matches.length > 0) {
        c.addableId = matches[0].id;
      }
    } catch {
      // leave addableId undefined; createPlaylist falls back to c.id
    }
  }
}

/**
 * Match one track: search its native store (when nativeSearch is on and the
 * track's script implies a non-account region), score there, then bridge the
 * candidates back to the account store via ISRC so they can be added to the
 * user's library.
 */
async function processTrack(
  track: NormalizedTrack,
  accountStore: string,
  prefs: MatchPreferences
): Promise<AppleMatchResult> {
  const query = `${track.originalName} ${track.artists[0] ?? ""}`.trim();
  const nativeStore = prefs.nativeSearch ? detectStorefrontForTrack(track, prefs.cjkDetection) : undefined;
  const searchStore = nativeStore && nativeStore !== accountStore ? nativeStore : accountStore;

  const songs = await appleSearch(query, searchStore);
  const result = await matchSingleTrack(track, songs, searchStore, prefs);

  // Bridge to the account store only when we searched a different region.
  if (searchStore !== accountStore && result.candidates && result.candidates.length > 0) {
    await bridgeCandidatesToAccountStore(result.candidates, accountStore);
    // Re-point the auto-selected id to its addable counterpart when resolved.
    if (result.selectedId) {
      const sel = result.candidates.find((c) => c.id === result.selectedId);
      if (sel?.addableId) {
        result.appleMusicId = sel.addableId;
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
  onProgress?: (processed: number, total: number, result: AppleMatchResult) => void
): Promise<AppleMatchReport> {
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

  // Resolve the account storefront: explicit override wins, else auto-detect.
  let accountStore = prefs.storefront.trim();
  if (!accountStore) {
    try {
      accountStore = await appleGetStorefront();
    } catch {
      accountStore = "us";
    }
  }

  const total = playlist.tracks.length;
  const results: AppleMatchResult[] = [];
  for (const track of playlist.tracks) {
    let result: AppleMatchResult;
    try {
      result = await processTrack(track, accountStore, prefs);
    } catch (error) {
      result = { track, status: "not_found", candidates: [], reason: (error as Error).message };
    }
    results.push(result);
    onProgress?.(results.length, total, result);
    // Small delay to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    provider: playlist.provider,
    playlistId: playlist.id,
    playlistName: playlist.name,
    results
  };
}

/**
 * Create an Apple Music playlist from matched tracks.
 */
export async function createAppleMusicPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  return appleCreatePlaylist(name, description, trackIds);
}
