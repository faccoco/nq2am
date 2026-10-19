import type { AppleMatchResult, AppleQueryVariant } from "../types.js";

export type RetrievalReplayItem = {
  id: string;
  correctCandidateIds: string[];
  candidates: Array<{
    id: string;
    provenance?: Array<{ variant: AppleQueryVariant; rank: number }>;
  }>;
  requestCount: number;
  provenance: string;
};

export type RetrievalReplayReport = {
  sampleCount: number;
  recallAtK: Record<number, number>;
  perQueryContribution: Partial<Record<AppleQueryVariant, number>>;
  requestCount: number;
  averageRequestCount: number;
  unresolved: string[];
};

export function evaluateRetrievalReplay(
  items: readonly RetrievalReplayItem[],
  configuredK: readonly number[] = [1, 5, 10]
): RetrievalReplayReport {
  const kValues = [...new Set(configuredK.filter((value) => Number.isInteger(value) && value > 0))].sort(
    (a, b) => a - b
  );
  const hits = new Map(kValues.map((value) => [value, 0]));
  const contribution: Partial<Record<AppleQueryVariant, number>> = {};
  const unresolved: string[] = [];
  let requestCount = 0;

  for (const item of items) {
    requestCount += item.requestCount;
    const correct = new Set(item.correctCandidateIds);
    const firstIndex = item.candidates.findIndex((candidate) => correct.has(candidate.id));
    for (const k of kValues) {
      if (firstIndex >= 0 && firstIndex < k) hits.set(k, (hits.get(k) ?? 0) + 1);
    }
    if (firstIndex < 0) {
      unresolved.push(item.id);
      continue;
    }
    const candidate = item.candidates[firstIndex];
    const firstSource = [...(candidate.provenance ?? [])].sort((left, right) => left.rank - right.rank)[0];
    if (firstSource) contribution[firstSource.variant] = (contribution[firstSource.variant] ?? 0) + 1;
  }

  const sampleCount = items.length;
  return {
    sampleCount,
    recallAtK: Object.fromEntries(kValues.map((k) => [k, sampleCount === 0 ? 0 : (hits.get(k) ?? 0) / sampleCount])),
    perQueryContribution: contribution,
    requestCount,
    averageRequestCount: sampleCount === 0 ? 0 : requestCount / sampleCount,
    unresolved
  };
}

export type DecisionReplayCategory =
  | "extra_source_artist"
  | "alias_or_transliteration"
  | "different_album"
  | "omitted_suffix"
  | "duplicate_release"
  | "recording_version"
  | "other";

export type DecisionReplayItem = {
  id: string;
  expectedCandidateIds: string[];
  expectedStatus?: AppleMatchResult["status"];
  result: AppleMatchResult;
  category: DecisionReplayCategory;
  provenance: string;
};

export type DecisionMetricCounts = {
  samples: number;
  automatic: number;
  correctAutomatic: number;
  incorrectAutomatic: number;
  ambiguous: number;
  scoreRejected: number;
};

export type DecisionReplayReport = DecisionMetricCounts & {
  automaticPrecision: number;
  automaticRecall: number;
  ambiguityRate: number;
  scoreRejectionRate: number;
  errorsByCategory: Partial<Record<DecisionReplayCategory, string[]>>;
};

export function evaluateDecisionReplay(items: readonly DecisionReplayItem[]): DecisionReplayReport {
  const counts: DecisionMetricCounts = {
    samples: items.length,
    automatic: 0,
    correctAutomatic: 0,
    incorrectAutomatic: 0,
    ambiguous: 0,
    scoreRejected: 0
  };
  const errorsByCategory: Partial<Record<DecisionReplayCategory, string[]>> = {};

  for (const item of items) {
    if (item.expectedStatus && item.result.status !== item.expectedStatus) {
      const categoryErrors = errorsByCategory[item.category] ?? [];
      categoryErrors.push(`${item.id}: expected ${item.expectedStatus} got ${item.result.status}`);
      errorsByCategory[item.category] = categoryErrors;
    }
    if (item.result.status === "matched" && item.result.selectionSource !== "manual") {
      counts.automatic += 1;
      if (item.result.selectedId && item.expectedCandidateIds.includes(item.result.selectedId)) {
        counts.correctAutomatic += 1;
      } else {
        counts.incorrectAutomatic += 1;
        const categoryErrors = errorsByCategory[item.category] ?? [];
        categoryErrors.push(item.id);
        errorsByCategory[item.category] = categoryErrors;
      }
    } else if (item.result.status === "ambiguous") {
      counts.ambiguous += 1;
    } else if (item.result.status === "score_rejected") {
      counts.scoreRejected += 1;
    }
  }

  return {
    ...counts,
    automaticPrecision: counts.automatic === 0 ? 1 : counts.correctAutomatic / counts.automatic,
    automaticRecall: counts.samples === 0 ? 0 : counts.correctAutomatic / counts.samples,
    ambiguityRate: counts.samples === 0 ? 0 : counts.ambiguous / counts.samples,
    scoreRejectionRate: counts.samples === 0 ? 0 : counts.scoreRejected / counts.samples,
    errorsByCategory
  };
}

export type ThresholdSweepItem = {
  id: string;
  bestConfidence: number;
  runnerUpConfidence?: number;
  bestIsCorrect: boolean;
  automaticEligible: boolean;
};

export type ThresholdSweepRow = {
  threshold: number;
  reviewThreshold: number;
  margin: number;
  automaticPrecision: number;
  automaticRecall: number;
  ambiguityRate: number;
  scoreRejectionRate: number;
};

/** Deterministic offline sweep; rows are sorted by precision, then recall. */
export function sweepRecordingThresholds(
  items: readonly ThresholdSweepItem[],
  automaticThresholds: readonly number[],
  reviewThresholds: readonly number[],
  margins: readonly number[]
): ThresholdSweepRow[] {
  const rows: ThresholdSweepRow[] = [];
  for (const threshold of automaticThresholds) {
    for (const reviewThreshold of reviewThresholds) {
      if (reviewThreshold > threshold) continue;
      for (const margin of margins) {
        let automatic = 0;
        let correct = 0;
        let ambiguous = 0;
        let rejected = 0;
        for (const item of items) {
          const gap = item.bestConfidence - (item.runnerUpConfidence ?? 0);
          if (item.automaticEligible && item.bestConfidence >= threshold && gap >= margin) {
            automatic += 1;
            if (item.bestIsCorrect) correct += 1;
          } else if (item.bestConfidence >= reviewThreshold) {
            ambiguous += 1;
          } else {
            rejected += 1;
          }
        }
        rows.push({
          threshold,
          reviewThreshold,
          margin,
          automaticPrecision: automatic === 0 ? 1 : correct / automatic,
          automaticRecall: items.length === 0 ? 0 : correct / items.length,
          ambiguityRate: items.length === 0 ? 0 : ambiguous / items.length,
          scoreRejectionRate: items.length === 0 ? 0 : rejected / items.length
        });
      }
    }
  }
  return rows.sort(
    (left, right) =>
      right.automaticPrecision - left.automaticPrecision ||
      right.automaticRecall - left.automaticRecall ||
      left.ambiguityRate - right.ambiguityRate ||
      right.threshold - left.threshold ||
      right.margin - left.margin
  );
}
