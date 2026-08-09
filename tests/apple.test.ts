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

test("Apple Music matcher searches by song name and artists", async () => {
  const { matchAppleMusic } = await loadAppModule();
  let searchedTerm: string | undefined;
  let searchedStorefront: string | undefined;
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "search-term",
    name: "Search term",
    tracks: [
      {
        originalName: " Song (Live) [Remaster] ",
        artists: ["Primary Artist", " Featured Artist "],
        source: { provider: "qq", playlistId: "search-term", songId: "song", raw: {} }
      }
    ],
    raw: {}
  };

  await matchAppleMusic(playlist, { ...DEFAULT_MATCH_PREFERENCES, storefront: "jp" }, undefined, {
    logger: () => {},
    sessionFactory: async () => ({
      search: async (term, storefront) => {
        searchedTerm = term;
        searchedStorefront = storefront;
        return [];
      },
      getStorefront: async () => "us",
      createPlaylist: async () => "playlist",
      getStats: () => ({ requestCount: 1, retryCount: 0 }),
      close: async () => {}
    })
  });

  assert.equal(searchedTerm, "Song Primary Artist Featured Artist");
  assert.equal(searchedStorefront, "jp");
});

test("Apple Music matcher switches Japanese-character searches to the Japan storefront", async () => {
  const { containsJapaneseCharacters, matchAppleMusic } = await loadMatcherModule();
  const searches: Array<{ term: string; storefront: string }> = [];
  const playlist: NormalizedPlaylist = {
    provider: "netease",
    id: "japanese-storefront",
    tracks: [
      {
        originalName: "ASCII Song",
        artists: ["ASCII Artist"],
        source: { provider: "netease", raw: {} }
      },
      {
        originalName: "名前のない怪物",
        artists: ["EGOIST"],
        source: { provider: "netease", raw: {} }
      }
    ],
    raw: {}
  };

  await matchAppleMusic(playlist, { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", matchConcurrency: 1 }, undefined, {
    logger: () => {},
    sessionFactory: async () => ({
      search: async (term, storefront) => {
        searches.push({ term, storefront });
        return [];
      },
      getStorefront: async () => "us",
      createPlaylist: async () => "playlist",
      getStats: () => ({ requestCount: searches.length, retryCount: 0 }),
      close: async () => {}
    })
  });

  assert.equal(containsJapaneseCharacters("ASCII Song"), false);
  assert.equal(containsJapaneseCharacters("名前のない怪物"), true);
  assert.deepEqual(searches, [
    { term: "ASCII Song ASCII Artist", storefront: "us" },
    { term: "名前のない怪物 EGOIST", storefront: "jp" }
  ]);
});

test("Apple Music matcher normalizes title strings before measuring distance", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: " ＳＯＮＧ’S ",
      artists: ["Unrelated source artist"],
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("farther", { name: "songs!", artistName: "Source artist" }),
      appleSongWith("normalized", { name: "songS", artistName: "Different artist" })
    ],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "normalized");
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.id, candidate.titleDistance]),
    [
      ["normalized", 0],
      ["farther", 1]
    ]
  );
});

test("Apple Music matcher moves source and Apple feat annotations into deduplicated artists", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song (feat. Guest)",
      artists: ["Primary", "Guest"],
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("apple-song", {
        name: "Song [feat. Guest]",
        artistName: "Primary"
      })
    ],
    "us"
  );

  assert.equal(result.track.originalName, "Song");
  assert.deepEqual(result.track.artists, ["Primary", "Guest"]);
  assert.equal(result.candidates?.[0]?.name, "Song");
  assert.equal(result.candidates?.[0]?.artistName, "Primary, Guest");
  assert.equal(result.candidates?.[0]?.titleDistance, 0);
});

test("Apple Music matcher sorts candidates by title Levenshtein distance", async () => {
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
      appleSongWith("far", { name: "A Completely Different Song" }),
      appleSongWith("near", { name: "Songs" }),
      appleSongWith("exact", { name: "Song", albumName: "Source Album" })
    ],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "exact");
  assert.equal(result.sameTrack, undefined);
  assert.equal(result.candidates?.[0]?.albumDistance, 0);
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.id, candidate.titleDistance]),
    [
      ["exact", 0],
      ["near", 1],
      ["far", 23]
    ]
  );
});

test("Apple Music matcher removes trailing Single suffixes before comparing albums", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album - Single",
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("single", { name: "Song", albumName: "Album – Single" })],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.track.albumName, "Album");
  assert.equal(result.candidates?.[0]?.albumName, "Album");
  assert.equal(result.candidates?.[0]?.albumDistance, 0);
  assert.equal(result.sameTrack, undefined);
});

test("Apple Music matcher marks every non-exact title as not found", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("near", { name: "Songs" }), appleSongWith("far", { name: "Different" })],
    "us"
  );

  assert.equal(result.status, "not_found");
  assert.equal(result.selectedId, undefined);
  assert.equal(result.appleMusicId, undefined);
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.id, candidate.titleDistance]),
    [
      ["near", 1],
      ["far", 8]
    ]
  );
  assert.match(result.reason ?? "", /exact title match required/i);
});

test("Apple Music matcher uses album distance to break title-distance ties", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Source Artist"],
      albumName: "Source Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("first", {
        name: "Song",
        artistName: "Wrong Artist",
        albumName: "Wrong Album",
        durationMs: 999_000
      }),
      appleSongWith("second", {
        name: "Song",
        artistName: "Source Artist",
        albumName: "Source Album",
        durationMs: 180_000
      })
    ],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "second");
  assert.equal(result.sameTrack, undefined);
  assert.deepEqual(
    result.candidates?.map((candidate) => candidate.id),
    ["second", "first"]
  );
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.titleDistance, candidate.albumDistance]),
    [
      [0, 0],
      [0, 6]
    ]
  );
});

test("Apple Music matcher prefers the smallest nonzero album distance for equal titles", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Source Album",
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("far", { name: "Song", albumName: "Wrong Album" }),
      appleSongWith("near", { name: "Song", albumName: "Source Albums" })
    ],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "near");
  assert.equal(result.sameTrack, true);
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.id, candidate.albumDistance]),
    [
      ["near", 1],
      ["far", 6]
    ]
  );
});

test("Apple Music matcher removes round and square bracket annotations from title comparison", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song (Off Vocal) ［Source Note］",
      artists: ["Artist"],
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("plain", { name: "Song" }), appleSongWith("annotated", { name: "Song （Live）[Remaster]" })],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.track.originalName, "Song");
  assert.equal(result.selectedId, "plain");
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.id, candidate.name, candidate.titleDistance]),
    [
      ["plain", "Song", 0],
      ["annotated", "Song", 0]
    ]
  );
});

test("Apple Music matcher matches Love it after removing title annotations", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Love it! (New Original Version)",
      artists: ["S.C.X", "初音ミク"],
      albumName: "Sound Collection - New Original",
      durationMs: 331_730,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("956732093", {
        name: "Love it! (New Original Version) [feat. Hatsune Miku]",
        artistName: "Clean Tears",
        albumName: "Sound Collection - New Original",
        durationMs: 331_730
      })
    ],
    "jp"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.track.originalName, "Love it!");
  assert.equal(result.selectedId, "956732093");
  assert.equal(result.candidates?.[0]?.name, "Love it!");
  assert.equal(result.candidates?.[0]?.artistName, "Clean Tears, Hatsune Miku");
  assert.equal(result.candidates?.[0]?.titleDistance, 0);
  assert.equal(result.candidates?.[0]?.albumDistance, 0);
});

test("Apple Music matcher keeps Apple order when album distance is unavailable", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      source: { provider: "qq", raw: {} }
    },
    [appleSong("a", cover("blue")), appleSong("b", cover("red"))],
    "us"
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "a");
  assert.deepEqual(
    result.candidates?.map((candidate) => [candidate.id, candidate.albumDistance]),
    [
      ["a", undefined],
      ["b", undefined]
    ]
  );
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
        candidates: [{ id: "apple-ok", name: "Matched", artistName: "Artist", titleDistance: 0 }]
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
        candidates: [{ id: "apple-no", name: "Manual no match", artistName: "Artist", titleDistance: 0 }],
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
          candidates: [{ id: "keep", name: "Keep", artistName: "Artist", titleDistance: 0 }]
        },
        {
          track: selectedTrack,
          status: "ambiguous",
          candidates: [{ id: "selected", name: "Selected", artistName: "Artist", titleDistance: 0 }]
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

test("Apple Music report refresh recomputes stale candidate distances", async () => {
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
              titleDistance: 99,
              storefront: "us"
            }
          ],
          reason: "stale candidate order"
        }
      ]
    },
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].selectedId, "good");
  assert.equal(report.results[0].candidates?.[0]?.titleDistance, 0);
});
