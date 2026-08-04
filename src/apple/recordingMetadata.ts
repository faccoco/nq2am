import type { AppleArtistEvidence, AppleArtistPairEvidence, ParsedRecordingMetadata } from "../types.js";
import { REVIEWED_ARTIST_ALIASES } from "./artistAliases.js";

export type RecordingFacetCategory = "recording" | "structural" | "release";

type FacetRule = {
  category: RecordingFacetCategory;
  facet: string;
  pattern: RegExp;
};

const FACET_RULES: readonly FacetRule[] = [
  { category: "recording", facet: "off_vocal", pattern: /\boff[\s_-]*vocal\b/iu },
  {
    category: "recording",
    facet: "instrumental",
    pattern: /\binstrumental(?:\s+version)?\b|インスト(?:ゥルメンタル)?/iu
  },
  { category: "recording", facet: "karaoke", pattern: /\bkaraoke\b|カラオケ/iu },
  { category: "recording", facet: "live", pattern: /\blive(?:\s+(?:at|from|in)\b)?|ライブ(?:版|ver(?:sion)?\.?)?/iu },
  { category: "recording", facet: "remix", pattern: /\b(?:re)?mix(?:ed)?\b|リミックス/iu },
  { category: "recording", facet: "cover", pattern: /\bcover(?:ed)?\b|カバー/iu },
  { category: "recording", facet: "acoustic", pattern: /\bacoustic\b|アコースティック/iu },
  { category: "recording", facet: "demo", pattern: /\bdemo\b/iu },
  { category: "recording", facet: "edit", pattern: /\b(?:tv\s*size|short\s+(?:edit|version)|edited\s+version)\b/iu },
  { category: "structural", facet: "radio_edit", pattern: /\bradio\s+(?:edit|version)\b/iu },
  { category: "structural", facet: "extended", pattern: /\bextended(?:\s+(?:mix|version|ver\.?))?\b/iu },
  { category: "structural", facet: "long", pattern: /\blong(?:\s+(?:mix|version|ver\.?))?\b/iu },
  { category: "structural", facet: "full", pattern: /\bfull(?:\s+(?:mix|version|ver\.?))?\b/iu },
  { category: "structural", facet: "album_version", pattern: /\balbum\s+(?:mix|version|ver\.?)\b/iu },
  {
    category: "structural",
    facet: "generic_version",
    pattern: /\bver(?:sion)?\.?\s*[\p{L}\p{N}_+.-]*|[\p{L}\p{N}_+.-]+\s+ver\.?\b/iu
  },
  { category: "release", facet: "remaster", pattern: /\b(?:\d{4}\s+)?remaster(?:ed)?\b|リマスター/iu },
  { category: "release", facet: "anniversary", pattern: /\b(?:\d+(?:st|nd|rd|th)\s+)?anniversary\b/iu },
  { category: "release", facet: "deluxe", pattern: /\bdeluxe\b/iu },
  { category: "release", facet: "single", pattern: /\bsingle\b/iu },
  { category: "release", facet: "edition", pattern: /\b(?:special|expanded|limited|collector(?:s)?)\s+edition\b/iu }
] as const;

const FEATURED_PATTERN = /\b(?:feat(?:uring)?|ft|with)\.?\s+([^()[\]{}]+?)(?=$|\s*[-–—]|\s*[)\]】}])/giu;
const WRAPPED_SEGMENT = /([([{（【])([^()[\]{}（）【】]+)([)\]}）】])/gu;

export function normalizeRecordingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/＆/gu, "&")
    .replace(/[’`']/gu, "")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeFacetText(value: string): string {
  return normalizeRecordingText(value).replace(/[_.]/gu, " ");
}

function matchingFacets(value: string): FacetRule[] {
  const normalized = normalizeFacetText(value);
  return FACET_RULES.filter((rule) => rule.pattern.test(normalized));
}

function splitCredits(value: string): string[] {
  return value
    .replace(/\s+(?:and|x)\s+/giu, ",")
    .split(/[,;&/／、，+]|\s+&\s+/u)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function removeFeaturedCredits(value: string, featuredArtists: string[]): string {
  return value.replace(FEATURED_PATTERN, (_whole, artists: string) => {
    featuredArtists.push(...splitCredits(artists));
    return " ";
  });
}

function segmentIsMetadata(segment: string): boolean {
  const normalized = normalizeFacetText(segment);
  if (matchingFacets(normalized).length > 0) return true;
  return /^(?:feat(?:uring)?|ft|with)\.?\b/iu.test(normalized);
}

function stripFacetSegments(value: string): string {
  let next = value.replace(WRAPPED_SEGMENT, (whole, _open: string, segment: string) =>
    segmentIsMetadata(segment) ? " " : whole
  );

  // Remove only suffix descriptors after a separator. Keeping arbitrary
  // parenthesized text protects titles where parentheses are part of the name.
  next = next.replace(/\s*[-:：]\s*([^\n]+)$/u, (whole, segment: string) => (segmentIsMetadata(segment) ? " " : whole));
  // Some services append an unwrapped suffix ("Song Extended") while others
  // omit it. Strip only a recognized trailing descriptor when a base title is
  // present; a title that consists solely of "Live", for example, is kept.
  next = next.replace(
    /(?<=\S)\s+(?:(?:album\s+)?(?:extended|long|full)\s*(?:mix|version|ver\.?)?|radio\s+(?:edit|version)|off[\s_-]*vocal|instrumental(?:\s+version)?|karaoke|live|remix|cover|(?:\d{4}\s+)?remaster(?:ed)?|(?:special|expanded|limited)\s+edition)\s*$/iu,
    " "
  );
  return next;
}

export function parseRecordingMetadata(title: string): ParsedRecordingMetadata {
  const normalized = normalizeRecordingText(title);
  const featuredArtists: string[] = [];
  const withoutFeatured = removeFeaturedCredits(normalized, featuredArtists);
  const facets = matchingFacets(withoutFeatured);
  const baseTitle = stripFacetSegments(withoutFeatured)
    .replace(/[([{（【]\s*[)\]}）】]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[-:：\s]+|[-:：\s]+$/gu, "")
    .trim();

  return {
    baseTitle: baseTitle || normalized,
    featuredArtists: [...new Set(featuredArtists.map(normalizeRecordingText).filter(Boolean))],
    recordingFacets: [
      ...new Set(facets.filter((rule) => rule.category === "recording").map((rule) => rule.facet))
    ].sort(),
    structuralFacets: [
      ...new Set(facets.filter((rule) => rule.category === "structural").map((rule) => rule.facet))
    ].sort(),
    releaseFacets: [...new Set(facets.filter((rule) => rule.category === "release").map((rule) => rule.facet))].sort()
  };
}

function characterNgrams(value: string, size: number): string[] {
  const compact = normalizeRecordingText(value).replace(/[^\p{L}\p{N}]/gu, "");
  if (!compact) return [];
  if (compact.length <= size) return [compact];
  return Array.from({ length: compact.length - size + 1 }, (_, index) => compact.slice(index, index + size));
}

function multisetDice(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const item of right) counts.set(item, (counts.get(item) ?? 0) + 1);
  let overlap = 0;
  for (const item of left) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(item, count - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length);
}

export function characterNgramSimilarity(left: string, right: string, size = 2): number {
  return roundEvidence(multisetDice(characterNgrams(left, size), characterNgrams(right, size)));
}

function jaroSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const distance = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array<boolean>(left.length).fill(false);
  const rightMatches = new Array<boolean>(right.length).fill(false);
  let matches = 0;

  for (let index = 0; index < left.length; index += 1) {
    const start = Math.max(0, index - distance);
    const end = Math.min(index + distance + 1, right.length);
    for (let other = start; other < end; other += 1) {
      if (rightMatches[other] || left[index] !== right[other]) continue;
      leftMatches[index] = true;
      rightMatches[other] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  const matchedLeft = [...left].filter((_char, index) => leftMatches[index]);
  const matchedRight = [...right].filter((_char, index) => rightMatches[index]);
  const transpositions =
    matchedLeft.reduce((count, char, index) => count + (char === matchedRight[index] ? 0 : 1), 0) / 2;
  return (matches / left.length + matches / right.length + (matches - transpositions) / matches) / 3;
}

export function shortNameSimilarity(left: string, right: string): number {
  const a = normalizeRecordingText(left).replace(/[^\p{L}\p{N}]/gu, "");
  const b = normalizeRecordingText(right).replace(/[^\p{L}\p{N}]/gu, "");
  if (!a || !b) return 0;
  const jaro = jaroSimilarity(a, b);
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
  return roundEvidence(jaro + prefix * 0.1 * (1 - jaro));
}

function tokens(value: string): string[] {
  return normalizeRecordingText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function tokenSimilarity(left: string, right: string): number {
  return roundEvidence(multisetDice(tokens(left), tokens(right)));
}

export function recordingTextSimilarity(left: string, right: string): number {
  const a = normalizeRecordingText(left).replace(/[^\p{L}\p{N}]/gu, "");
  const b = normalizeRecordingText(right).replace(/[^\p{L}\p{N}]/gu, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  return roundEvidence(
    Math.max(characterNgramSimilarity(a, b), shortNameSimilarity(a, b), tokenSimilarity(left, right))
  );
}

export function splitArtistCredits(values: readonly string[]): string[] {
  return values
    .flatMap((value) =>
      normalizeRecordingText(value)
        .replace(/\b(?:feat(?:uring)?|ft|with)\.?\b/giu, ",")
        .replace(/\s+(?:and|x)\s+/giu, ",")
        .split(/[,;&/／、，+]|\s+&\s+/u)
    )
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function aliasKey(value: string): string {
  return normalizeRecordingText(value).replace(/[^\p{L}\p{N}]/gu, "");
}

const ALIAS_GROUP_BY_NAME = new Map<string, number>();
for (const [groupIndex, group] of REVIEWED_ARTIST_ALIASES.entries()) {
  for (const name of group) ALIAS_GROUP_BY_NAME.set(aliasKey(name), groupIndex);
}

export function areApprovedArtistAliases(left: string, right: string): boolean {
  const leftKey = aliasKey(left);
  const rightKey = aliasKey(right);
  if (!leftKey || leftKey === rightKey) return false;
  const leftGroup = ALIAS_GROUP_BY_NAME.get(leftKey);
  return leftGroup !== undefined && leftGroup === ALIAS_GROUP_BY_NAME.get(rightKey);
}

function artistPair(left: string, right: string): AppleArtistPairEvidence {
  const alias = areApprovedArtistAliases(left, right);
  return {
    source: left,
    candidate: right,
    similarity: alias ? 1 : recordingTextSimilarity(left, right),
    alias
  };
}

/** Greedy maximum one-to-one credit pairing with deterministic tie ordering. */
export function compareArtistCredits(
  sourceValues: readonly string[],
  candidateValues: readonly string[]
): AppleArtistEvidence {
  const source = splitArtistCredits(sourceValues);
  const candidate = splitArtistCredits(candidateValues);
  if (source.length === 0 || candidate.length === 0) {
    return {
      primaryPair: 0,
      candidateCoverage: 0,
      sourceCoverage: 0,
      pairs: [],
      aliases: [],
      hasPrimaryRelationship: false
    };
  }

  const possibilities = source.flatMap((sourceName, sourceIndex) =>
    candidate.map((candidateName, candidateIndex) => ({
      ...artistPair(sourceName, candidateName),
      sourceIndex,
      candidateIndex
    }))
  );
  possibilities.sort(
    (left, right) =>
      right.similarity - left.similarity ||
      left.sourceIndex - right.sourceIndex ||
      left.candidateIndex - right.candidateIndex
  );

  const usedSource = new Set<number>();
  const usedCandidate = new Set<number>();
  const pairs: AppleArtistPairEvidence[] = [];
  for (const possibility of possibilities) {
    if (usedSource.has(possibility.sourceIndex) || usedCandidate.has(possibility.candidateIndex)) continue;
    usedSource.add(possibility.sourceIndex);
    usedCandidate.add(possibility.candidateIndex);
    pairs.push({
      source: possibility.source,
      candidate: possibility.candidate,
      similarity: possibility.similarity,
      alias: possibility.alias
    });
  }

  const sourceScores = source.map((name) => Math.max(...candidate.map((other) => artistPair(name, other).similarity)));
  const candidateScores = candidate.map((name) =>
    Math.max(...source.map((other) => artistPair(other, name).similarity))
  );
  const primaryPair = Math.max(...source.map((name) => artistPair(name, candidate[0]).similarity));
  const aliases = pairs.filter((pair) => pair.alias).map((pair) => `${pair.source} = ${pair.candidate}`);

  return {
    primaryPair: roundEvidence(primaryPair),
    candidateCoverage: roundEvidence(candidateScores.reduce((sum, score) => sum + score, 0) / candidateScores.length),
    sourceCoverage: roundEvidence(sourceScores.reduce((sum, score) => sum + score, 0) / sourceScores.length),
    pairs,
    aliases,
    hasPrimaryRelationship: primaryPair >= 0.72 || pairs.some((pair) => pair.alias)
  };
}

export function roundEvidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}
