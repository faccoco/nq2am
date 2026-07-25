import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AppleSong } from "../src/apple/api.js";
import { matchSingleTrack } from "../src/apple/matcher.js";
import { DEFAULT_MATCH_PREFERENCES, type NormalizedTrack } from "../src/types.js";

type RealSongCandidate = {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  durationInMillis: number;
  isrc: string;
};

type RealSongCase = {
  track: {
    name: string;
    artists: string[];
    albumName: string;
    durationMs: number;
  };
  expectedSelectedId: string;
  candidates: RealSongCandidate[];
};

type RealSongFixture = {
  source: {
    task: string;
    playlist: string;
    capturedAt: number;
    threshold: number;
    ambiguousGap: number;
  };
  cases: RealSongCase[];
};

const fixture = JSON.parse(await readFile("tests/fixtures/real-songs-same-recording.json", "utf8")) as RealSongFixture;

function normalizedTrack(songCase: RealSongCase): NormalizedTrack {
  return {
    originalName: songCase.track.name,
    artists: songCase.track.artists,
    albumName: songCase.track.albumName,
    durationMs: songCase.track.durationMs,
    source: {
      provider: "netease",
      playlistId: fixture.source.task.replace("netease-", ""),
      raw: {}
    }
  };
}

function appleSongs(songCase: RealSongCase): AppleSong[] {
  return songCase.candidates.map((candidate) => ({
    id: candidate.id,
    type: "songs",
    attributes: {
      name: candidate.name,
      artistName: candidate.artistName,
      albumName: candidate.albumName,
      durationInMillis: candidate.durationInMillis,
      isrc: candidate.isrc
    }
  }));
}

test("real-song fixture captures the previous run's complete ambiguous candidate sets and GT", () => {
  assert.equal(fixture.source.task, "netease-13026355216");
  assert.equal(fixture.cases.length, 40);
  assert.equal(
    fixture.cases.reduce((count, songCase) => count + songCase.candidates.length, 0),
    182
  );

  for (const songCase of fixture.cases) {
    assert.ok(
      songCase.candidates.some((candidate) => candidate.id === songCase.expectedSelectedId),
      `${songCase.track.name} GT should identify one saved candidate`
    );
  }
});

test("real-song matcher selects the album-similarity GT", async (t) => {
  const prefs = {
    ...DEFAULT_MATCH_PREFERENCES,
    threshold: fixture.source.threshold,
    ambiguousGap: fixture.source.ambiguousGap
  };

  for (const songCase of fixture.cases) {
    await t.test(`${songCase.track.name} — ${songCase.track.albumName}`, async () => {
      const result = await matchSingleTrack(normalizedTrack(songCase), appleSongs(songCase), "cn", prefs);

      assert.equal(result.status, "matched");
      assert.equal(result.selectedId, songCase.expectedSelectedId);
      assert.ok(result.candidates);
      assert.ok(result.candidates.some((candidate) => candidate.id === songCase.expectedSelectedId));
      assert.match(result.reason ?? "", /album similarity/);
    });
  }
});
