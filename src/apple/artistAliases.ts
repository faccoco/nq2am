import type { AppleMatchReport } from "../types.js";

/**
 * Reviewed artist aliases used by the v2 matcher. New suggestions are never
 * added here automatically; this file is intentionally version controlled.
 */
export const REVIEWED_ARTIST_ALIASES: readonly (readonly string[])[] = [
  ["初音ミク", "Hatsune Miku", "Miku Hatsune"],
  ["鏡音リン", "Kagamine Rin", "Rin Kagamine"],
  ["鏡音レン", "Kagamine Len", "Len Kagamine"],
  ["巡音ルカ", "Megurine Luka", "Luka Megurine"],
  ["重音テト", "Kasane Teto", "Teto Kasane"],
  ["トゲナシトゲアリ", "TOGENASHI TOGEARI"],
  ["cosMo@暴走P", "cosMo@Bousou-P", "cosMo"],
  ["void", "void(Mournfinale)", "void (Mournfinale)"],
  ["モリモリあつし", "Morimori Atsushi"],
  ["平井堅", "Ken Hirai"],
  ["米津玄師", "Kenshi Yonezu"],
  ["小糸侑", "Yuu Koito"],
  ["七海燈子", "Touko Nanami"],
  ["目黒将司", "Shoji Meguro"],
  ["川村ゆみ", "Yumi Kawamura"]
] as const;

export type ArtistAliasSuggestion = {
  sourceArtist: string;
  candidateArtist: string;
  confirmations: number;
};

function suggestionKey(sourceArtist: string, candidateArtist: string): string {
  return `${sourceArtist.trim()}\u0000${candidateArtist.trim()}`;
}

/**
 * Extract offline alias suggestions from explicit manual selections. The
 * result is diagnostic data only and is never consulted by runtime matching.
 */
export function extractArtistAliasSuggestions(reports: readonly AppleMatchReport[]): ArtistAliasSuggestion[] {
  const suggestions = new Map<string, ArtistAliasSuggestion>();
  for (const report of reports) {
    for (const result of report.results) {
      if (result.status !== "matched" || result.selectionSource !== "manual" || !result.selectedId) continue;
      const sourceArtist = result.track.artists[0]?.trim();
      const selected = result.candidates?.find((candidate) => candidate.id === result.selectedId);
      const candidateArtist = selected?.artistName.trim();
      if (!sourceArtist || !candidateArtist || sourceArtist === candidateArtist) continue;

      const key = suggestionKey(sourceArtist, candidateArtist);
      const existing = suggestions.get(key);
      if (existing) {
        existing.confirmations += 1;
      } else {
        suggestions.set(key, { sourceArtist, candidateArtist, confirmations: 1 });
      }
    }
  }
  return [...suggestions.values()].sort(
    (left, right) =>
      right.confirmations - left.confirmations ||
      left.sourceArtist.localeCompare(right.sourceArtist) ||
      left.candidateArtist.localeCompare(right.candidateArtist)
  );
}
