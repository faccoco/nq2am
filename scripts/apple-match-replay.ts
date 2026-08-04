import { readFile, writeFile } from "node:fs/promises";
import type { AppleSong } from "../src/apple/api.js";
import { matchSingleTrack } from "../src/apple/matcher.js";
import {
  type DecisionReplayCategory,
  type DecisionReplayItem,
  evaluateDecisionReplay,
  evaluateRetrievalReplay,
  type RetrievalReplayItem,
  sweepRecordingThresholds,
  type ThresholdSweepItem
} from "../src/apple/replay.js";
import { DEFAULT_MATCH_PREFERENCES, type NormalizedTrack } from "../src/types.js";

type ReplayCase = {
  id: string;
  category: DecisionReplayCategory;
  track: { name: string; artists: string[]; album: string; durationMs: number };
  expectedIds: string[];
  candidates: Array<{
    id: string;
    name: string;
    artist: string;
    album: string;
    durationMs: number;
    isrc?: string;
  }>;
  provenance?: string;
};

type Fixture = { cases: ReplayCase[] };
type RealFixture = {
  cases: Array<{
    track: { name: string; artists: string[]; albumName: string; durationMs: number };
    expectedSelectedId: string;
    candidates: Array<{
      id: string;
      name: string;
      artistName: string;
      albumName: string;
      durationInMillis: number;
      isrc?: string;
    }>;
  }>;
};

const fixture = JSON.parse(await readFile("tests/fixtures/apple-recording-patterns.json", "utf8")) as Fixture;
const realFixture = JSON.parse(await readFile("tests/fixtures/real-songs-same-recording.json", "utf8")) as RealFixture;
const v1Baseline = JSON.parse(await readFile("tests/fixtures/apple-matching-v1-baseline.json", "utf8")) as {
  labeledTracks: number;
  candidateEntries: number;
};
const replayCases: ReplayCase[] = [
  ...fixture.cases,
  ...realFixture.cases.map((item, index) => ({
    id: `real-release-${index + 1}-${item.track.name}`,
    category: "duplicate_release" as const,
    track: {
      name: item.track.name,
      artists: item.track.artists,
      album: item.track.albumName,
      durationMs: item.track.durationMs
    },
    expectedIds: [item.expectedSelectedId],
    candidates: item.candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      artist: candidate.artistName,
      album: candidate.albumName,
      durationMs: candidate.durationInMillis,
      isrc: candidate.isrc
    })),
    provenance: "tests/fixtures/real-songs-same-recording.json"
  }))
];
const decisions: DecisionReplayItem[] = [];
const retrievalItems: RetrievalReplayItem[] = [];
const sweepItems: ThresholdSweepItem[] = [];

for (const item of replayCases) {
  const track: NormalizedTrack = {
    originalName: item.track.name,
    artists: item.track.artists,
    albumName: item.track.album,
    durationMs: item.track.durationMs,
    source: { provider: "netease", raw: {} }
  };
  const songs: AppleSong[] = item.candidates.map((candidate) => ({
    id: candidate.id,
    type: "songs",
    attributes: {
      name: candidate.name,
      artistName: candidate.artist,
      albumName: candidate.album,
      durationInMillis: candidate.durationMs,
      isrc: candidate.isrc
    }
  }));
  const result = await matchSingleTrack(track, songs, "jp", DEFAULT_MATCH_PREFERENCES, async () => undefined);
  decisions.push({
    id: item.id,
    expectedCandidateIds: item.expectedIds,
    result,
    category: item.category,
    provenance: item.provenance ?? "tests/fixtures/apple-recording-patterns.json"
  });
  const contributionVariant =
    item.category === "extra_source_artist"
      ? "base_additional_artist"
      : item.category === "omitted_suffix"
        ? "base_primary_artist"
        : item.category === "different_album"
          ? "base_album"
          : "original_primary_artist";
  retrievalItems.push({
    id: item.id,
    correctCandidateIds: item.expectedIds,
    candidates: songs.map((song, index) => ({
      id: song.id,
      provenance: [
        {
          variant: item.expectedIds.includes(song.id) ? contributionVariant : "original_primary_artist",
          rank: index + 1
        }
      ]
    })),
    requestCount: contributionVariant === "original_primary_artist" ? 1 : 2,
    provenance: "maintained fixture"
  });
  sweepItems.push({
    id: item.id,
    bestConfidence: result.decision?.bestGroupConfidence ?? 0,
    runnerUpConfidence: result.decision?.runnerUpGroupConfidence,
    bestIsCorrect:
      Boolean(result.selectedId && item.expectedIds.includes(result.selectedId)) ||
      Boolean(result.recordingGroups?.[0]?.candidateIds.some((id) => item.expectedIds.includes(id))),
    automaticEligible: result.recordingGroups?.[0]?.automaticEligible ?? false
  });
}

const report = {
  schemaVersion: 1,
  scoringVersion: DEFAULT_MATCH_PREFERENCES.scoringVersion,
  defaults: {
    threshold: DEFAULT_MATCH_PREFERENCES.threshold,
    reviewThreshold: DEFAULT_MATCH_PREFERENCES.reviewThreshold,
    ambiguousGap: DEFAULT_MATCH_PREFERENCES.ambiguousGap
  },
  v1Baseline: {
    path: "tests/fixtures/apple-matching-v1-baseline.json",
    labeledTracks: v1Baseline.labeledTracks,
    candidateEntries: v1Baseline.candidateEntries
  },
  coveredRegressions: [
    "extra source artists",
    "different albums",
    "omitted structural suffixes",
    "duplicate releases",
    "recording-changing version hard negatives",
    "bounded base-title retrieval escalation (unit replay)"
  ],
  retrieval: evaluateRetrievalReplay(retrievalItems),
  decision: evaluateDecisionReplay(decisions),
  bestSweepRows: sweepRecordingThresholds(
    sweepItems,
    [0.8, 0.82, 0.84, 0.86, 0.88],
    [0.58, 0.6, 0.62, 0.64],
    [0.06, 0.08, 0.1, 0.12]
  ).slice(0, 12),
  limitations: [
    "The corpus combines 40 confirmed release selections with seven category-balanced recording patterns.",
    "No eligible persisted manual no-match corpus is checked in; unlabeled not-found rows are deliberately excluded.",
    "Saved candidate fixtures measure classifier behavior; live storefront recall is not inferred from unlabeled not-found rows."
  ]
};

const output = process.argv[2];
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
