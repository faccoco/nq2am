import type { ParsedRecordingMetadata, VersionDescriptor, VersionRelation } from "../types.js";
import { foldHanToSimplified } from "./hanFold.js";

function normalizeRecordingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/＆/gu, "&")
    .replace(/[’`']/gu, "")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function identityCompactText(value: string): string {
  return foldHanToSimplified(normalizeRecordingText(value)).replace(/[^\p{L}\p{N}]/gu, "");
}

/** Review-band cap for a named-version conflict: never auto-wins, stays reviewable. */
export const NAMED_VERSION_CONFLICT_CAP = 0.78;

const STRUCTURAL_KINDS = new Set<VersionDescriptor["kind"]>([
  "extended",
  "long",
  "full",
  "radio_edit",
  "album_version"
]);

const RECORDING_KINDS = new Set<VersionDescriptor["kind"]>([
  "off_vocal",
  "instrumental",
  "karaoke",
  "live",
  "remix",
  "cover",
  "acoustic",
  "demo",
  "tv",
  "edit"
]);

const PHRASE_SYNONYMS: Array<[RegExp, string]> = [
  [/北京語|中国語|普通話|mandarin|chinese/giu, "mandarin"],
  [/日本語|japanese/giu, "japanese"],
  [/英語|english/giu, "english"],
  [/ピアノ|piano/giu, "piano"],
  [/オーケストラ|orchestral|orchestra/giu, "orchestral"],
  [/アコースティック|acoustic/giu, "acoustic"],
  [/ゲーム|game/giu, "game"],
  [/バンド|band/giu, "band"],
  [/周年記念|周年|anniversary/giu, "anniversary"],
  [/リマスター|remaster(?:ed)?/giu, "remaster"]
];

export function normalizeFacetText(value: string): string {
  return normalizeRecordingText(value).replace(/[_.]/gu, " ");
}

export function foldVersionPayload(value: string): string {
  let next = foldHanToSimplified(normalizeFacetText(value));
  for (const [pattern, replacement] of PHRASE_SYNONYMS) {
    next = next.replace(pattern, ` ${replacement} `);
  }
  return identityCompactText(next);
}

function extractOrdinal(text: string): string | undefined {
  const match = text.match(/(\d+)\s*(?:st|nd|rd|th)?/iu);
  return match?.[1];
}

function hasVersionWrapper(text: string): boolean {
  return /ver(?:sion)?\b|#\s*\d+\s*ver|版|アレンジ/iu.test(text);
}

/**
 * Classify a single parenthetical or suffix segment. Returns undefined when the
 * segment is not a version/release descriptor (so song-title parentheses stay).
 */
export function classifyVersionSegment(raw: string): VersionDescriptor | undefined {
  const text = normalizeFacetText(raw);
  if (!text || /^(?:feat(?:uring)?|ft|with)\.?\b/iu.test(text)) return undefined;

  const recording = matchRecordingKind(text);
  if (recording) return { category: "recording", kind: recording, payload: "", raw: text };

  if (/\b(?:\d{4}\s+)?remaster(?:ed)?\b|リマスター/iu.test(text)) {
    return {
      category: "release",
      kind: "remaster",
      ordinal: text.match(/\b(19|20)\d{2}\b/u)?.[0],
      payload: "",
      raw: text,
      identityRelevant: false
    };
  }

  const structural = matchStructuralKind(text);
  if (structural) {
    return { category: "structural", kind: structural, payload: "", raw: text, identityRelevant: true };
  }

  const anniversary = /\b(?:\d+(?:st|nd|rd|th)\s+)?anniversary\b|周年(?:記念)?/iu.test(text);
  if (anniversary) {
    const wrapped = hasVersionWrapper(text);
    return {
      category: wrapped ? "named" : "release",
      kind: "anniversary",
      ordinal: extractOrdinal(text),
      payload: "anniversary",
      raw: text,
      identityRelevant: wrapped
    };
  }

  if (/\bdeluxe\b/iu.test(text)) {
    return { category: "release", kind: "named", payload: "deluxe", raw: text, identityRelevant: false };
  }
  if (/\bsingle\b/iu.test(text)) {
    return { category: "release", kind: "named", payload: "single", raw: text, identityRelevant: false };
  }
  if (/\b(?:special|expanded|limited|collector(?:s)?)\s+edition\b/iu.test(text)) {
    return { category: "release", kind: "named", payload: "edition", raw: text, identityRelevant: false };
  }
  if (/主题曲|片头曲|片尾曲|插曲/u.test(text) || /(?:电影|电视剧|电视|动画|动漫)/u.test(text)) {
    return { category: "release", kind: "named", payload: "theme", raw: text, identityRelevant: false };
  }

  if (!hasVersionWrapper(text) && !/アレンジ/iu.test(text)) return undefined;

  const payloadText = text
    .replace(/#\s*(\d+)\s*ver(?:sion)?\.?/giu, " $1 ")
    .replace(/\bver(?:sion)?\.?\b/giu, " ")
    .replace(/アレンジ/giu, " ")
    .replace(/版/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const folded = foldVersionPayload(payloadText);
  if (!folded) return undefined;

  const kind = kindFromPayload(folded);
  return {
    category: "named",
    kind,
    ordinal: extractOrdinal(payloadText),
    payload: folded,
    raw: text,
    identityRelevant: true
  };
}

function matchRecordingKind(text: string): VersionDescriptor["kind"] | undefined {
  if (/\boff[\s_-]*vocal\b/iu.test(text)) return "off_vocal";
  if (/\binstrumental(?:\s+version)?\b|インスト(?:ゥルメンタル)?|伴奏/iu.test(text)) return "instrumental";
  if (/\bkaraoke\b|カラオケ/iu.test(text)) return "karaoke";
  if (/\blive(?:\s+(?:at|from|in)\b)?|ライブ(?:版|ver(?:sion)?\.?)?|现场(?:\s*版)?|演唱会/iu.test(text)) {
    return "live";
  }
  if (/\bremix(?:ed)?\b|リミックス|dj\s*版/iu.test(text)) return "remix";
  if (/\bcover(?:ed)?\b|カバー|翻唱/iu.test(text)) return "cover";
  if (/\bacoustic\b|アコースティック/iu.test(text)) return "acoustic";
  if (/\bdemo\b/iu.test(text)) return "demo";
  if (/\btv[\s_-]*size\b|tvサイズ/iu.test(text)) return "tv";
  if (/\b(?:short\s+(?:edit|version)|edited\s+version)\b/iu.test(text)) return "edit";
  return undefined;
}

function matchStructuralKind(text: string): VersionDescriptor["kind"] | undefined {
  if (/\bradio\s+(?:edit|version)\b/iu.test(text)) return "radio_edit";
  if (/\bextended(?:\s+(?:mix|version|ver\.?))?\b/iu.test(text)) return "extended";
  if (/\blong(?:\s+(?:mix|version|ver\.?))?\b/iu.test(text)) return "long";
  if (/\bfull(?:\s+(?:mix|version|ver\.?))?\b|完整版/iu.test(text)) return "full";
  if (/\balbum\s+(?:mix|version|ver\.?)\b/iu.test(text)) return "album_version";
  return undefined;
}

function kindFromPayload(folded: string): VersionDescriptor["kind"] {
  if (folded === "piano" || folded.includes("piano")) return "piano";
  if (folded === "band" || folded.endsWith("band") || folded.includes("band")) return "band";
  if (folded === "orchestral" || folded.includes("orchestral")) return "orchestral";
  if (folded === "game") return "game";
  if (folded === "mandarin" || folded === "japanese" || folded === "english") return "language";
  if (folded === "anniversary") return "anniversary";
  return "named";
}

export function descriptorsAreMetadata(segment: string): boolean {
  return classifyVersionSegment(segment) !== undefined;
}

export function identityDescriptors(parsed: ParsedRecordingMetadata): VersionDescriptor[] {
  return parsed.versionDescriptors.filter((descriptor) => descriptor.identityRelevant !== false);
}

function descriptorKey(descriptor: VersionDescriptor): string {
  if (RECORDING_KINDS.has(descriptor.kind) || STRUCTURAL_KINDS.has(descriptor.kind)) return descriptor.kind;
  if (descriptor.kind === "anniversary") return `anniversary:${descriptor.ordinal ?? ""}`;
  return `${descriptor.kind}:${descriptor.payload}`;
}

function namedCompatible(left: VersionDescriptor, right: VersionDescriptor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "anniversary") {
    if (!left.ordinal || !right.ordinal) return true;
    return left.ordinal === right.ordinal;
  }
  if (!left.payload || !right.payload) return left.payload === right.payload;
  return left.payload === right.payload;
}

function recordingKindSet(parsed: ParsedRecordingMetadata): string {
  return [...new Set(parsed.recordingFacets)].sort().join("|");
}

export function compareVersionRelation(
  source: ParsedRecordingMetadata,
  candidate: ParsedRecordingMetadata
): VersionRelation {
  if (recordingKindSet(source) !== recordingKindSet(candidate)) return "conflict";

  const sourceIdentity = identityDescriptors(source).filter((descriptor) => !RECORDING_KINDS.has(descriptor.kind));
  const candidateIdentity = identityDescriptors(candidate).filter(
    (descriptor) => !RECORDING_KINDS.has(descriptor.kind)
  );
  const sourceNamed = sourceIdentity.filter((descriptor) => !STRUCTURAL_KINDS.has(descriptor.kind));
  const candidateNamed = candidateIdentity.filter((descriptor) => !STRUCTURAL_KINDS.has(descriptor.kind));
  const sourceStructural = new Set(
    sourceIdentity.filter((descriptor) => STRUCTURAL_KINDS.has(descriptor.kind)).map((descriptor) => descriptor.kind)
  );
  const candidateStructural = new Set(
    candidateIdentity.filter((descriptor) => STRUCTURAL_KINDS.has(descriptor.kind)).map((descriptor) => descriptor.kind)
  );

  if (sourceNamed.length > 0 && candidateNamed.length > 0) {
    const agrees = sourceNamed.every((left) => candidateNamed.some((right) => namedCompatible(left, right)));
    const reverse = candidateNamed.every((right) => sourceNamed.some((left) => namedCompatible(left, right)));
    if (!agrees || !reverse) return "conflict";
  } else if (sourceNamed.length !== candidateNamed.length) {
    return "named_omit";
  }

  const structuralEqual =
    sourceStructural.size === candidateStructural.size &&
    [...sourceStructural].every((kind) => candidateStructural.has(kind));
  if (!structuralEqual) return "structural_omit";
  return "agree";
}

export function versionConflictSummary(
  source: ParsedRecordingMetadata,
  candidate: ParsedRecordingMetadata
): { source: string; candidate: string } | undefined {
  const describe = (parsed: ParsedRecordingMetadata): string => {
    const identity = identityDescriptors(parsed).filter((descriptor) => !RECORDING_KINDS.has(descriptor.kind));
    if (identity.length === 0) return "unlabelled";
    return identity
      .map((descriptor) => descriptor.raw || descriptorKey(descriptor))
      .sort()
      .join(", ");
  };
  if (compareVersionRelation(source, candidate) !== "conflict") return undefined;
  return { source: describe(source), candidate: describe(candidate) };
}

export function candidateCarriesUnrequestedNamedVersion(
  source: ParsedRecordingMetadata,
  candidate: ParsedRecordingMetadata
): boolean {
  const sourceNamed = identityDescriptors(source).filter(
    (descriptor) => !RECORDING_KINDS.has(descriptor.kind) && !STRUCTURAL_KINDS.has(descriptor.kind)
  );
  const candidateNamed = identityDescriptors(candidate).filter(
    (descriptor) => !RECORDING_KINDS.has(descriptor.kind) && !STRUCTURAL_KINDS.has(descriptor.kind)
  );
  if (candidateNamed.length === 0) return false;
  if (sourceNamed.length === 0) return true;
  return candidateNamed.some((right) => !sourceNamed.some((left) => namedCompatible(left, right)));
}

export function versionsCanGroup(left: ParsedRecordingMetadata, right: ParsedRecordingMetadata): boolean {
  const relation = compareVersionRelation(left, right);
  return relation !== "conflict";
}
