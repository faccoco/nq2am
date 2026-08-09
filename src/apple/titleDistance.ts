const FEATURED_ARTIST_ANNOTATION_RE = /^feat\.?\s+(.+)$/iu;
const ARTIST_SEPARATOR_RE = /\s*[,，、/／&＆+]\s*/u;
const SINGLE_ALBUM_SUFFIX_RE = /\s*[-‐‑‒–—]\s*single\s*$/iu;
const TITLE_BRACKET_PAIRS = new Map<string, string>([
  ["(", ")"],
  ["（", "）"],
  ["[", "]"],
  ["［", "］"]
]);

type TitleBracketRange = {
  start: number;
  end: number;
};

function removeBracketedTitleParts(title: string): { title: string; annotations: string[] } {
  const stack: Array<{ start: number; closingBracket: string }> = [];
  const ranges: TitleBracketRange[] = [];

  for (let index = 0; index < title.length; index += 1) {
    const character = title[index];
    const closingBracket = TITLE_BRACKET_PAIRS.get(character);
    if (closingBracket) {
      stack.push({ start: index, closingBracket });
      continue;
    }

    const openBracket = stack.at(-1);
    if (openBracket && character === openBracket.closingBracket) {
      stack.pop();
      ranges.push({ start: openBracket.start, end: index });
    }
  }

  if (ranges.length === 0) {
    return { title, annotations: [] };
  }

  const annotations = ranges.map(({ start, end }) => title.slice(start + 1, end).trim()).filter(Boolean);
  const mergedRanges: TitleBracketRange[] = [];
  for (const range of ranges.sort((left, right) => left.start - right.start || right.end - left.end)) {
    const previous = mergedRanges.at(-1);
    if (!previous || range.start > previous.end) {
      mergedRanges.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }

  const titleParts: string[] = [];
  let cursor = 0;
  for (const range of mergedRanges) {
    titleParts.push(title.slice(cursor, range.start));
    cursor = range.end + 1;
  }
  titleParts.push(title.slice(cursor));

  return {
    title: titleParts.join(" ").replace(/\s+/gu, " ").trim(),
    annotations
  };
}

function artistKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function artistKeys(value: string): string[] {
  const whole = artistKey(value);
  if (!whole) return [];
  return [whole, ...value.split(ARTIST_SEPARATOR_RE).map(artistKey).filter(Boolean)];
}

function mergeUniqueArtists(existing: readonly string[], additions: readonly string[]): string[] {
  const result: string[] = [];
  const knownKeys = new Set<string>();

  for (const artist of [...existing, ...additions]) {
    const trimmed = artist.trim();
    const keys = artistKeys(trimmed);
    if (keys.length === 0) continue;

    const [whole, ...parts] = keys;
    if (knownKeys.has(whole) || (parts.length > 1 && parts.every((part) => knownKeys.has(part)))) {
      continue;
    }

    result.push(trimmed);
    for (const key of keys) knownKeys.add(key);
  }

  return result;
}

export function normalizeTitleMetadata(
  title: string,
  artists: readonly string[]
): { title: string; artists: string[] } {
  const strippedTitle = removeBracketedTitleParts(title);
  const featuredArtists = strippedTitle.annotations
    .map((annotation) => annotation.normalize("NFKC").match(FEATURED_ARTIST_ANNOTATION_RE)?.[1]?.trim())
    .filter((artist): artist is string => Boolean(artist));

  return {
    title: strippedTitle.title,
    artists: mergeUniqueArtists(artists, featuredArtists)
  };
}

export function normalizeComparableText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/＆/gu, "&").replace(/[’']/gu, "").trim();
}

export function normalizeAlbumMetadata(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(SINGLE_ALBUM_SUFFIX_RE, "").trim();
  return normalized || undefined;
}

export function normalizeTitle(value: string): string {
  const { title } = normalizeTitleMetadata(value, []);
  return normalizeComparableText(title);
}

function levenshteinDistance(leftValue: string, rightValue: string): number {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);

  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previous[rightIndex] = current[rightIndex];
    }
  }

  return previous[right.length];
}

/** Compute the Unicode code-point Levenshtein distance between normalized title strings. */
export function titleLevenshteinDistance(sourceTitle: string, candidateTitle: string): number {
  return levenshteinDistance(normalizeTitle(sourceTitle), normalizeTitle(candidateTitle));
}

/** Compute the Unicode code-point Levenshtein distance between normalized album strings. */
export function albumLevenshteinDistance(sourceAlbum: string, candidateAlbum: string): number {
  const normalizedSource = normalizeComparableText(sourceAlbum).replace(SINGLE_ALBUM_SUFFIX_RE, "").trim();
  const normalizedCandidate = normalizeComparableText(candidateAlbum).replace(SINGLE_ALBUM_SUFFIX_RE, "").trim();
  return levenshteinDistance(normalizedSource, normalizedCandidate);
}
