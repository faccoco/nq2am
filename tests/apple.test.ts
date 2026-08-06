import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppleSong } from "../src/apple/api.js";
import type { AppleContentRating, NormalizedPlaylist, NormalizedTrack } from "../src/types.js";
import { DEFAULT_MATCH_PREFERENCES } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-test-"));

let appModule: Promise<typeof import("../src/index.js")> | undefined;
function loadAppModule(): Promise<typeof import("../src/index.js")> {
  appModule ??= import("../src/index.js");
  return appModule;
}

let matcherModule: Promise<typeof import("../src/apple/matcher.js")> | undefined;
function loadMatcherModule(): Promise<typeof import("../src/apple/matcher.js")> {
  matcherModule ??= import("../src/apple/matcher.js");
  return matcherModule;
}

function cover(fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function appleSong(
  id: string,
  artworkUrl?: string,
  contentRating?: AppleContentRating,
  albumName = "Album"
): AppleSong {
  return {
    id,
    type: "songs",
    attributes: {
      name: "Song",
      artistName: "Artist",
      albumName,
      durationInMillis: 180_000,
      artwork: artworkUrl ? { url: artworkUrl } : undefined,
      contentRating
    }
  };
}

function appleSongWith(
  id: string,
  attrs: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationMs?: number;
    artworkUrl?: string;
    contentRating?: AppleContentRating;
  } = {}
): AppleSong {
  return {
    id,
    type: "songs",
    attributes: {
      name: attrs.name ?? "Song",
      artistName: attrs.artistName ?? "Artist",
      albumName: attrs.albumName ?? "Album",
      durationInMillis: attrs.durationMs ?? 180_000,
      artwork: attrs.artworkUrl ? { url: attrs.artworkUrl } : undefined,
      contentRating: attrs.contentRating
    }
  };
}

test("Apple Music matcher returns explicit not implemented results", async () => {
  const { matchAppleMusic } = await loadAppModule();
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "p1",
    name: "Fixture",
    tracks: [
      {
        originalName: "Song",
        artists: ["Artist"],
        source: {
          provider: "qq",
          playlistId: "p1",
          songId: "s1",
          raw: {}
        }
      }
    ],
    raw: {}
  };

  const report = await matchAppleMusic(playlist);

  assert.equal(report.provider, "qq");
  assert.equal(report.playlistId, "p1");
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].status, "not_implemented");
});

test("Apple Music matcher normalizes exact metadata score and records breakdown", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [appleSong("exact")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  const best = result.candidates?.[0];
  assert.ok(best);
  assert.ok(best.score >= 0.99);
  assert.ok(best.score <= 1);
  const breakdown = best.scoreBreakdown;
  assert.ok(breakdown);
  assert.equal(breakdown.total, best.score);
  assert.equal(breakdown.fields.title, 1);
  assert.equal(breakdown.fields.artist, 1);
  assert.equal(breakdown.fields.album, 1);
  assert.equal(breakdown.fields.duration, 1);
});

test("Apple Music matcher scores source-album candidates above same-title wrong albums", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Source Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("wrong-album", { albumName: "Other Album" }),
      appleSongWith("source-album", { albumName: "Source Album" })
    ],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "source-album");
  const sourceAlbum = result.candidates?.find((c) => c.id === "source-album");
  const wrongAlbum = result.candidates?.find((c) => c.id === "wrong-album");
  assert.ok(sourceAlbum && wrongAlbum);
  assert.ok(sourceAlbum.score > wrongAlbum.score);
});

test("Apple Music matcher keeps text identity stronger than duration", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("right-text-wrong-duration", { durationMs: 260_000 }),
      appleSongWith("wrong-text-right-duration", {
        name: "Different Song",
        artistName: "Other Artist",
        durationMs: 180_000
      })
    ],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "right-text-wrong-duration");
  const winner = result.candidates?.[0];
  assert.ok(winner);
  assert.ok(winner.score <= 1);
  const breakdown = winner.scoreBreakdown;
  assert.ok(breakdown);
  assert.equal(breakdown.fields.duration, 0);
});

test("Apple Music matcher rejects unwanted off-vocal versions below threshold", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("off-vocal", { name: "Song (Off Vocal)" })],
    "us",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.8 }
  );

  assert.equal(result.status, "not_found");
  assert.match(result.reason ?? "", /below threshold/);
});

test("Apple Music matcher allows requested off-vocal versions", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song (Off Vocal)",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("plain", { name: "Song" }), appleSongWith("off-vocal", { name: "Song (Off Vocal)" })],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "off-vocal");
});

test("Apple Music matcher treats feat annotations as credits, not title or album mismatches", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "初音ミクの消失",
      artists: ["cosMo@暴走P", "初音ミク"],
      albumName: "初音ミクの消失",
      durationMs: 292_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("download", {
        name: "初音ミクの消失",
        artistName: "cosMo@暴走P feat.石川綾子",
        albumName: "Download (feat.初音ミク)",
        durationMs: 289_000
      }),
      appleSongWith("single", {
        name: "初音ミクの消失 (feat. 初音ミク)",
        artistName: "cosMo@暴走P",
        albumName: "初音ミクの消失 (feat. 初音ミク)",
        durationMs: 292_000
      })
    ],
    "jp",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.8 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "single");
  assert.ok((result.candidates?.find((c) => c.id === "single")?.score ?? 0) >= 0.9);
});

test("Apple Music matcher treats remaster annotations as version metadata", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "fragments (2015 rework)",
      artists: ["kamome sano"],
      albumName: "archive001:reworks+",
      durationMs: 290_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("remaster", {
        name: "Fragments (2015 Rework) [2022 Remaster]",
        artistName: "Kamome Sano",
        albumName: "Archive001:Reworks+ (2022 Remaster)",
        durationMs: 290_000
      })
    ],
    "tr",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.8 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "remaster");
  assert.ok((result.candidates?.[0]?.score ?? 0) >= 0.9);
});

test("Apple Music matcher treats Apple single album suffixes as the source album", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "最強STRONGER",
      artists: ["REDALiCE", "USAO"],
      albumName: "最強STRONGER",
      durationMs: 142_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("single", {
        name: "最強STRONGER",
        artistName: "REDALiCE & USAO",
        albumName: "最強STRONGER - Single",
        durationMs: 142_000
      }),
      appleSongWith("compilation", {
        name: "最強STRONGER",
        artistName: "REDALiCE & USAO",
        albumName: "Arcaea Sound Collection: Memories of Wrath",
        durationMs: 143_000
      })
    ],
    "cn",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "single");
  const winner = result.candidates?.find((candidate) => candidate.id === "single");
  assert.ok(winner);
  assert.equal(winner.scoreBreakdown?.fields.album, 1);
});

test("Apple Music matcher selects the first-ranked indistinguishable candidate", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      source: { provider: "qq", raw: {} }
    },
    [appleSong("a", cover("blue")), appleSong("b", cover("red"))],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "a");
});

test("Apple Music retry only replaces not-found results", async () => {
  const { retryNotFoundAppleMusic } = await loadMatcherModule();
  const matchedTrack: NormalizedTrack = {
    originalName: "Matched",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const missingTrack: NormalizedTrack = {
    originalName: "Missing",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const manualNoMatchTrack: NormalizedTrack = {
    originalName: "Manual no match",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };

  const report = await retryNotFoundAppleMusic({
    provider: "qq",
    playlistId: "retry-only-not-found",
    playlistName: "Retry only not found",
    results: [
      {
        track: matchedTrack,
        status: "matched",
        selectedId: "apple-ok",
        appleMusicId: "apple-ok",
        candidates: [{ id: "apple-ok", name: "Matched", artistName: "Artist", score: 1 }]
      },
      {
        track: missingTrack,
        status: "not_found",
        candidates: [],
        reason: "No results from Apple Music search"
      },
      {
        track: manualNoMatchTrack,
        status: "not_found",
        selectionSource: "manual",
        candidates: [{ id: "apple-no", name: "Manual no match", artistName: "Artist", score: 0.9 }],
        reason: "Marked as no match"
      }
    ]
  });

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].appleMusicId, "apple-ok");
  assert.equal(report.results[1].status, "not_implemented");
  assert.equal(report.results[2].status, "not_implemented");
});

test("Apple Music retry can refresh selected result indices once", async () => {
  const { retryAppleMusicResults } = await loadMatcherModule();
  const keepTrack: NormalizedTrack = {
    originalName: "Keep",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const selectedTrack: NormalizedTrack = {
    originalName: "Selected",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const duplicateTrack: NormalizedTrack = {
    originalName: "Duplicate selected",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };

  const report = await retryAppleMusicResults(
    {
      provider: "qq",
      playlistId: "retry-selected",
      playlistName: "Retry selected",
      results: [
        {
          track: keepTrack,
          status: "matched",
          selectedId: "keep",
          appleMusicId: "keep",
          candidates: [{ id: "keep", name: "Keep", artistName: "Artist", score: 1 }]
        },
        {
          track: selectedTrack,
          status: "ambiguous",
          candidates: [{ id: "selected", name: "Selected", artistName: "Artist", score: 0.9 }]
        },
        {
          track: duplicateTrack,
          status: "not_found",
          candidates: [],
          reason: "No results from Apple Music search"
        }
      ]
    },
    [2, 1, 2]
  );

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].appleMusicId, "keep");
  assert.equal(report.results[1].status, "not_implemented");
  assert.equal(report.results[2].status, "not_implemented");
});

test("Apple Music retry replaces request failures with fresh semantic results", async () => {
  const { retryAppleMusicResults } = await loadMatcherModule();
  const tracks = ["Matched", "Ambiguous", "Missing", "Failed"].map(
    (originalName): NormalizedTrack => ({
      originalName,
      artists: ["Artist"],
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    })
  );
  const report = await retryAppleMusicResults(
    {
      provider: "qq",
      playlistId: "retry-request-failed",
      results: tracks.map((retryTrack) => ({
        track: retryTrack,
        status: "request_failed" as const,
        candidates: [],
        reason: "Previous request failed",
        requestFailure: { kind: "network" as const, operation: "search" as const }
      }))
    },
    [0, 1, 2, 3],
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", matchConcurrency: 1 },
    undefined,
    {
      logger: () => {},
      sessionFactory: async () => ({
        search: async (term) => {
          if (term.startsWith("Matched")) {
            return [appleSongWith("matched", { name: "Matched", artistName: "Artist", durationMs: 180_000 })];
          }
          if (term.startsWith("Ambiguous")) {
            return [
              appleSongWith("ambiguous-one", { name: "Ambiguous", artistName: "Artist", durationMs: 180_000 }),
              appleSongWith("ambiguous-two", { name: "Ambiguous", artistName: "Artist", durationMs: 180_000 })
            ];
          }
          if (term.startsWith("Failed")) {
            throw new Error("fetch failed");
          }
          return [];
        },
        getStorefront: async () => "us",
        createPlaylist: async () => "playlist",
        getStats: () => ({ requestCount: 4, retryCount: 0 }),
        close: async () => {}
      })
    }
  );

  assert.deepEqual(
    report.results.map((result) => result.status),
    ["matched", "matched", "not_found", "request_failed"]
  );
  assert.equal(report.results[0].requestFailure, undefined);
  assert.equal(report.results[2].reason, "No results from Apple Music search");
  assert.deepEqual(report.results[3].requestFailure, { kind: "network", operation: "search" });
});

test("Apple Music report refresh re-scores stale candidates against the threshold", async () => {
  const { refreshAppleMatchReportCandidates } = await loadMatcherModule();
  const report = await refreshAppleMatchReportCandidates(
    {
      provider: "netease",
      playlistId: "stale-report",
      playlistName: "Stale report",
      results: [
        {
          track: {
            originalName: "Song",
            artists: ["Artist"],
            albumName: "Album",
            durationMs: 180_000,
            source: { provider: "netease", raw: {} }
          },
          status: "not_found",
          candidates: [
            {
              id: "good",
              name: "Song",
              artistName: "Artist",
              albumName: "Album",
              durationMs: 180_000,
              score: 0.4,
              storefront: "us"
            }
          ],
          reason: "stale below threshold"
        }
      ]
    },
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].selectedId, "good");
  assert.ok((report.results[0].candidates?.[0]?.score ?? 0) >= 0.99);
});
