import type { AppleCandidateProvenance, AppleQueryVariant, MatchPreferences, NormalizedTrack } from "../types.js";
import type { AppleSong } from "./api.js";
import { normalizeRecordingText, parseRecordingMetadata } from "./recordingMetadata.js";

export const DEFAULT_APPLE_QUERY_BUDGET = 8;

export type AppleQueryPlanItem = {
  id: string;
  variant: AppleQueryVariant;
  term: string;
  storefront: string;
  required: boolean;
  fallback: boolean;
};

export type AppleQueryPlanOptions = {
  primaryStorefront: string;
  accountStorefront?: string;
  maxPasses?: number;
};

function normalizedTerm(value: string): string {
  return normalizeRecordingText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function appleQueryCacheKey(term: string, storefront: string): string {
  return `${storefront.trim().toLowerCase()}\u0000${normalizedTerm(term)}`;
}

function meaningfulArtists(track: NormalizedTrack): string[] {
  const parsed = parseRecordingMetadata(track.originalName);
  const credits = [...track.artists, ...parsed.featuredArtists]
    .flatMap((value) =>
      value
        .normalize("NFKC")
        .replace(/\b(?:feat(?:uring)?|ft|with)\.?\b/giu, ",")
        .replace(/\s+(?:and|x)\s+/giu, ",")
        .split(/[,;&/／、，+]|\s+&\s+/u)
    )
    .map((artist) => artist.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return credits.filter((artist) => {
    const key = normalizedTerm(artist);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryVariants(track: NormalizedTrack): Array<{ variant: AppleQueryVariant; term: string }> {
  const parsed = parseRecordingMetadata(track.originalName);
  const artists = meaningfulArtists(track);
  const primaryArtist = artists[0] ?? "";
  const original = track.originalName.trim();
  const base = parsed.baseTitle.trim() || original;
  const variants: Array<{ variant: AppleQueryVariant; term: string }> = [
    { variant: "original_primary_artist", term: `${original} ${primaryArtist}`.trim() }
  ];
  if (normalizedTerm(base) !== normalizedTerm(original)) {
    variants.push({ variant: "base_primary_artist", term: `${base} ${primaryArtist}`.trim() });
  }
  for (const artist of artists.slice(1, 3)) {
    variants.push({ variant: "base_additional_artist", term: `${base} ${artist}`.trim() });
  }
  if (track.albumName?.trim()) variants.push({ variant: "base_album", term: `${base} ${track.albumName}`.trim() });
  variants.push({ variant: "base_title", term: base });
  return variants;
}

/**
 * Build a deterministic, normalized plan. Native-store passes come first;
 * account-store fallback entries are retained within one fixed total budget.
 */
export function buildAppleQueryPlan(track: NormalizedTrack, options: AppleQueryPlanOptions): AppleQueryPlanItem[] {
  const maxPasses = Math.max(1, Math.floor(options.maxPasses ?? DEFAULT_APPLE_QUERY_BUDGET));
  const primaryStorefront = options.primaryStorefront.trim().toLowerCase();
  const accountStorefront = (options.accountStorefront ?? primaryStorefront).trim().toLowerCase();
  const variants = queryVariants(track);
  const plan: AppleQueryPlanItem[] = [];
  const seen = new Set<string>();

  const append = (storefront: string, fallback: boolean) => {
    for (const variant of variants) {
      if (plan.length >= maxPasses) break;
      const key = appleQueryCacheKey(variant.term, storefront);
      if (!normalizedTerm(variant.term) || seen.has(key)) continue;
      seen.add(key);
      plan.push({
        id: `q${plan.length + 1}`,
        variant: variant.variant,
        term: variant.term.replace(/\s+/gu, " ").trim(),
        storefront,
        required: plan.length === 0,
        fallback
      });
    }
  };

  append(primaryStorefront, false);
  if (accountStorefront && accountStorefront !== primaryStorefront) append(accountStorefront, true);
  return plan;
}

export type RetrievedAppleSong = {
  song: AppleSong;
  storefront: string;
  provenance: AppleCandidateProvenance[];
  firstSeen: number;
};

export function unionAppleSearchCandidates(
  existing: Map<string, RetrievedAppleSong>,
  songs: readonly AppleSong[],
  query: AppleQueryPlanItem,
  nextOrdinal: () => number
): void {
  songs.forEach((song, rank) => {
    const key = `${query.storefront}\u0000${song.id}`;
    const provenance: AppleCandidateProvenance = {
      queryId: query.id,
      variant: query.variant,
      term: query.term,
      storefront: query.storefront,
      rank: rank + 1
    };
    const current = existing.get(key);
    if (current) {
      if (!current.provenance.some((source) => source.queryId === query.id)) current.provenance.push(provenance);
      return;
    }
    existing.set(key, {
      song,
      storefront: query.storefront,
      provenance: [provenance],
      firstSeen: nextOrdinal()
    });
  });
}

export function queryPlanForTrack(
  track: NormalizedTrack,
  accountStorefront: string,
  prefs: MatchPreferences,
  detectStorefront: (track: NormalizedTrack, mode: MatchPreferences["cjkDetection"]) => string | undefined
): AppleQueryPlanItem[] {
  const native = prefs.nativeSearch ? detectStorefront(track, prefs.cjkDetection) : undefined;
  const primary = native && native !== accountStorefront ? native : accountStorefront;
  return buildAppleQueryPlan(track, {
    primaryStorefront: primary,
    accountStorefront,
    maxPasses: DEFAULT_APPLE_QUERY_BUDGET
  });
}
