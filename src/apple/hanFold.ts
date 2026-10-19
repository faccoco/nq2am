import { HAN_T2S } from "./hanFoldTable.js";

/** Fold traditional Han to simplified so 高橋 and 高桥 compare as the same string. */
export function foldHanToSimplified(value: string): string {
  let out = "";
  for (const char of value) out += HAN_T2S[char] ?? char;
  return out;
}
