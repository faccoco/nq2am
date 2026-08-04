import assert from "node:assert/strict";
import test from "node:test";
import type { AppleApiSession, AppleSong } from "../src/apple/api.js";
import { matchAppleMusic, matchSingleTrack } from "../src/apple/matcher.js";
import { parseRecordingMetadata } from "../src/apple/recordingMetadata.js";
import { buildAppleQueryPlan } from "../src/apple/retrieval.js";
import { DEFAULT_MATCH_PREFERENCES, type NormalizedPlaylist, type NormalizedTrack } from "../src/types.js";

function song(id: string, name: string, artistName = "Artist", durationInMillis = 180_000, isrc?: string): AppleSong {
  return {
    id,
    type: "songs",
    attributes: { name, artistName, albumName: "Album", durationInMillis, isrc }
  };
}

function track(name = "Song", artists = ["Artist"]): NormalizedTrack {
  return {
    originalName: name,
    artists,
    albumName: "Album",
    durationMs: 180_000,
    source: { provider: "qq", raw: {} }
  };
}

function session(search: AppleApiSession["search"]): AppleApiSession {
  return {
    search,
    songsByIsrc: async () => [],
    getStorefront: async () => "us",
    createPlaylist: async () => "playlist",
    getStats: () => ({ requestCount: 0, retryCount: 0 }),
    close: async () => {}
  };
}

async function runWithSearch(sourceTrack: NormalizedTrack, search: AppleApiSession["search"]) {
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "recording-v2",
    tracks: [sourceTrack],
    raw: {}
  };
  return matchAppleMusic(
    playlist,
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", nativeSearch: false, matchConcurrency: 1 },
    undefined,
    { logger: () => {}, sessionFactory: async () => session(search) }
  );
}

test("recording parser separates changing, structural, release, and featured metadata", () => {
  const parsed = parseRecordingMetadata("Song (feat. 初音ミク) [Extended Mix] (2024 Remaster)");
  assert.equal(parsed.baseTitle, "song");
  assert.deepEqual(parsed.featuredArtists, ["初音ミク"]);
  assert.deepEqual(parsed.structuralFacets, ["extended"]);
  assert.deepEqual(parsed.releaseFacets, ["remaster"]);

  assert.deepEqual(parseRecordingMetadata("Song (Live)").recordingFacets, ["live"]);
  assert.deepEqual(parseRecordingMetadata("Song - Off Vocal").recordingFacets, ["off_vocal"]);
  for (const [title, facet] of [
    ["Song (Remix)", "remix"],
    ["Song (Cover)", "cover"],
    ["Song (Instrumental)", "instrumental"],
    ["Song (Karaoke)", "karaoke"]
  ]) {
    assert.ok(parseRecordingMetadata(title).recordingFacets.includes(facet));
  }
  assert.ok(parseRecordingMetadata("Song (Long Version)").structuralFacets.includes("long"));
  assert.ok(parseRecordingMetadata("Song (Radio Edit)").structuralFacets.includes("radio_edit"));
  assert.ok(parseRecordingMetadata("Song (Game Ver.)").structuralFacets.includes("generic_version"));
  assert.equal(parseRecordingMetadata("Ｓｏｎｇ（Ｌｉｖｅ）").baseTitle, "song");
});

test("query planner is bounded, normalized, and includes native account fallback", () => {
  const plan = buildAppleQueryPlan(
    {
      ...track("Song (Extended)", ["Primary", "Featured"]),
      albumName: "Source Album"
    },
    { primaryStorefront: "jp", accountStorefront: "us", maxPasses: 8 }
  );
  assert.ok(plan.length <= 8);
  assert.equal(plan[0].variant, "original_primary_artist");
  assert.ok(plan.some((query) => query.variant === "base_primary_artist"));
  assert.ok(plan.some((query) => query.variant === "base_additional_artist"));
  assert.ok(plan.some((query) => query.variant === "base_album"));
  assert.ok(plan.some((query) => query.fallback && query.storefront === "us"));
  assert.equal(new Set(plan.map((query) => `${query.storefront}:${query.term.toLowerCase()}`)).size, plan.length);
});

test("retrieval escalates to a normalized base-title query and records provenance", async () => {
  const calls: string[] = [];
  const report = await runWithSearch(track("Song (Extended)"), async (term) => {
    calls.push(term);
    return term.toLowerCase().startsWith("song artist") ? [song("extended", "Song", "Artist", 180_000)] : [];
  });
  assert.equal(report.results[0].status, "matched");
  assert.ok(calls.length >= 2);
  assert.equal(report.results[0].retrieval?.earlyStopped, true);
  assert.equal(report.results[0].candidates?.[0].provenance?.[0].variant, "base_primary_artist");
});

test("native retrieval falls back to the account storefront only after native misses", async () => {
  const storefronts: string[] = [];
  const playlist: NormalizedPlaylist = {
    provider: "netease",
    id: "storefront-fallback",
    tracks: [{ ...track("ゆめ"), source: { provider: "netease", raw: {} } }],
    raw: {}
  };
  const report = await matchAppleMusic(
    playlist,
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", nativeSearch: true, matchConcurrency: 1 },
    undefined,
    {
      logger: () => {},
      sessionFactory: async () =>
        session(async (_term, storefront) => {
          storefronts.push(storefront);
          return storefront === "us" ? [song("account", "ゆめ")] : [];
        })
    }
  );

  assert.equal(report.results[0].status, "matched");
  assert.ok(storefronts.includes("jp"));
  assert.ok(storefronts.includes("us"));
});

test("candidate union deduplicates repeated responses and retains query provenance", async () => {
  const source = { ...track(), albumName: undefined, durationMs: undefined };
  const report = await runWithSearch(source, async () => [song("repeated", "Song")]);
  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].retrieval?.uniqueCandidateCount, 1);
  assert.equal(report.results[0].candidates?.[0].provenance?.length, 2);
});

test("optional retrieval failure preserves candidates from an earlier successful pass", async () => {
  let call = 0;
  const source = { ...track(), durationMs: undefined };
  const report = await runWithSearch(source, async () => {
    call += 1;
    if (call === 1) return [song("candidate", "Song")];
    if (call === 2) throw new Error("optional query failed");
    return [];
  });
  assert.equal(report.results[0].status, "matched");
  assert.ok(report.results[0].retrieval?.queries.some((query) => query.status === "failed"));
  assert.equal(report.results[0].requestFailure, undefined);
});

test("required retrieval failure remains request_failed", async () => {
  const report = await runWithSearch(track(), async () => {
    throw new Error("catalog transport failed");
  });
  assert.equal(report.results[0].status, "request_failed");
  assert.equal(report.results[0].retrieval?.outcome, "failed");
});

test("zero candidates and rejected candidates have distinct semantic outcomes", async () => {
  const noCandidates = await matchSingleTrack(track(), [], "us", DEFAULT_MATCH_PREFERENCES);
  const rejected = await matchSingleTrack(track(), [song("live", "Song (Live)")], "us", DEFAULT_MATCH_PREFERENCES);
  assert.equal(noCandidates.status, "not_found");
  assert.equal(rejected.status, "score_rejected");
});

test("same-recording releases are grouped before the ambiguity margin", async () => {
  const result = await matchSingleTrack(
    track(),
    [song("single", "Song", "Artist", 180_000, "ISRC-ONE"), song("album", "Song", "Artist", 181_000, "ISRC-ONE")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.status, "matched");
  assert.equal(result.recordingGroups?.length, 1);
  assert.equal(result.recordingGroups?.[0].candidateIds.length, 2);
});

test("conflicting reused ISRC versions are not merged", async () => {
  const result = await matchSingleTrack(
    track(),
    [song("original", "Song", "Artist", 180_000, "REUSED"), song("live", "Song (Live)", "Artist", 240_000, "REUSED")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.recordingGroups?.length, 2);
  assert.ok(result.recordingGroups?.some((group) => group.conflicts.length > 0));
});
