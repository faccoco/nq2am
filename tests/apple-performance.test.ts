import assert from "node:assert/strict";
import test from "node:test";
import type { AppleApiRequestMetric, AppleApiSession, AppleApiSessionOptions, AppleSong } from "../src/apple/api.js";
import { createArtworkComparator } from "../src/apple/artwork.js";
import { mapWithConcurrency } from "../src/apple/concurrency.js";
import {
  type AppleMatchLogEvent,
  createAppleMusicPlaylistFromReport,
  matchAppleMusic,
  resolveAppleMusicTrackIds
} from "../src/apple/matcher.js";
import { RequestStartScheduler, runWithRetry } from "../src/apple/requestScheduler.js";
import type { AppleMatchReport, NormalizedPlaylist } from "../src/types.js";
import { DEFAULT_MATCH_PREFERENCES } from "../src/types.js";

function song(id: string, name: string, artistName: string, isrc?: string, albumName = "Album"): AppleSong {
  return {
    id,
    type: "songs",
    attributes: {
      name,
      artistName,
      albumName,
      durationInMillis: 180_000,
      isrc
    }
  };
}

function cover(fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function fakeSession(
  implementation: Partial<AppleApiSession> = {},
  stats = { requestCount: 0, retryCount: 0 }
): AppleApiSession {
  return {
    search: async () => [],
    songsByIsrc: async () => [],
    getStorefront: async () => "us",
    createPlaylist: async () => "playlist",
    getStats: () => stats,
    close: async () => {},
    ...implementation
  };
}

test("request scheduler spaces concurrent request starts", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const starts: number[] = [];
  const scheduler = new RequestStartScheduler(100, {
    now: () => now,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      now += delayMs;
    }
  });

  await Promise.all(
    [1, 2, 3].map(() =>
      scheduler.schedule(async () => {
        starts.push(now);
      })
    )
  );

  assert.deepEqual(starts, [0, 100, 200]);
  assert.deepEqual(sleeps, [100, 100]);
});

test("request scheduler adds a bounded random pause after the fixed interval", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const starts: number[] = [];
  const scheduler = new RequestStartScheduler(100, {
    randomPauseMinMs: 20,
    randomPauseMaxMs: 60,
    random: () => 0.5,
    now: () => now,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      now += delayMs;
    }
  });

  await Promise.all(
    [1, 2, 3].map(() =>
      scheduler.schedule(async () => {
        starts.push(now);
      })
    )
  );

  assert.deepEqual(starts, [0, 140, 280]);
  assert.deepEqual(sleeps, [140, 140]);
});

test("bounded retry stops after success and runs backoff hooks", async () => {
  const retries: number[] = [];
  let attempts = 0;
  const result = await runWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("transient");
      }
      return "ok";
    },
    {
      maxAttempts: 3,
      shouldRetry: () => true,
      beforeRetry: (_error, attempt) => {
        retries.push(attempt);
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(retries, [1, 2]);
});

test("worker pool bounds concurrency and preserves source order", async () => {
  let active = 0;
  let maxActive = 0;
  const completionOrder: number[] = [];
  const delays = [25, 5, 15, 1];

  const results = await mapWithConcurrency(
    delays,
    2,
    async (delayMs, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      active -= 1;
      return index * 10;
    },
    (_result, index) => {
      completionOrder.push(index);
    }
  );

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [0, 10, 20, 30]);
  assert.notDeepEqual(completionOrder, [0, 1, 2, 3]);
});

test("playlist matching reuses one session, closes it, and preserves result order", async () => {
  let active = 0;
  let maxActive = 0;
  let closeCount = 0;
  let requestCount = 0;
  const requestMetrics: AppleApiRequestMetric[] = [];
  const progress: number[] = [];
  const logs: AppleMatchLogEvent[] = [];
  let sessionOptions: AppleApiSessionOptions | undefined;
  const delays = new Map([
    ["First", 25],
    ["Second", 5],
    ["Third", 10]
  ]);

  let onRequest: AppleApiSessionOptions["onRequest"];
  const session = fakeSession(
    {
      search: async (term) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const name = term.split(" ")[0];
        await new Promise((resolve) => setTimeout(resolve, delays.get(name) ?? 0));
        active -= 1;
        requestCount += 1;
        const metric: AppleApiRequestMetric = {
          operation: "search",
          attempt: 1,
          durationMs: delays.get(name) ?? 0,
          outcome: "success",
          status: 200
        };
        requestMetrics.push(metric);
        onRequest?.(metric);
        return [song(name.toLowerCase(), name, "Artist")];
      },
      getStats: () => ({ requestCount, retryCount: 0 }),
      close: async () => {
        closeCount += 1;
      }
    },
    { requestCount: 0, retryCount: 0 }
  );
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "concurrent-order",
    name: "Concurrent order",
    tracks: ["First", "Second", "Third"].map((originalName) => ({
      originalName,
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    })),
    raw: {}
  };

  const report = await matchAppleMusic(
    playlist,
    {
      ...DEFAULT_MATCH_PREFERENCES,
      nativeSearch: false,
      matchConcurrency: 2,
      appleRequestIntervalMs: 425,
      appleRequestTimeoutMs: 21_000,
      appleMaxAttempts: 4,
      appleRetryBaseDelayMs: 1_250,
      appleRandomPauseEnabled: true,
      appleRandomPauseMinMs: 300,
      appleRandomPauseMaxMs: 900,
      artworkTimeoutMs: 12_000
    },
    (processed) => progress.push(processed),
    {
      logger: (event) => logs.push(event),
      sessionFactory: async (options) => {
        sessionOptions = options;
        onRequest = options.onRequest;
        return session;
      }
    }
  );

  assert.equal(maxActive, 2);
  assert.equal(closeCount, 1);
  assert.equal(requestMetrics.length, 3);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(
    report.results.map((result) => result.track.originalName),
    ["First", "Second", "Third"]
  );
  assert.deepEqual(
    report.results.map((result) => result.selectedId),
    ["first", "second", "third"]
  );
  assert.equal(logs.at(-1)?.event, "job_complete");
  assert.equal(logs.at(-1)?.requestCount, 3);
  assert.equal(sessionOptions?.minRequestIntervalMs, 425);
  assert.equal(sessionOptions?.requestTimeoutMs, 21_000);
  assert.equal(sessionOptions?.maxAttempts, 4);
  assert.equal(sessionOptions?.baseRetryDelayMs, 1_250);
  assert.equal(sessionOptions?.randomPauseEnabled, true);
  assert.equal(sessionOptions?.randomPauseMinMs, 300);
  assert.equal(sessionOptions?.randomPauseMaxMs, 900);
});

test("native-store matching bridges only the automatically selected candidate", async () => {
  const isrcLookups: string[] = [];
  let closeCount = 0;
  const session = fakeSession({
    search: async (term) => {
      if (term.startsWith("ゆめ")) {
        return [song("native-winner", "ゆめ", "Artist", "WINNER"), song("native-wrong", "Different", "Other", "WRONG")];
      }
      return [
        song("ambiguous-a", "なみ", "Artist", "AMBIGUOUS-A", "Album A"),
        song("ambiguous-b", "なみ", "Artist", "AMBIGUOUS-B", "Album B")
      ];
    },
    songsByIsrc: async (isrc) => {
      isrcLookups.push(isrc);
      return [song("account-winner", "ゆめ", "Artist", isrc)];
    },
    close: async () => {
      closeCount += 1;
    }
  });
  const playlist: NormalizedPlaylist = {
    provider: "netease",
    id: "lazy-isrc",
    name: "Lazy ISRC",
    tracks: ["ゆめ", "なみ"].map((originalName) => ({
      originalName,
      artists: ["Artist"],
      durationMs: 180_000,
      source: { provider: "netease", raw: {} }
    })),
    raw: {}
  };

  const report = await matchAppleMusic(playlist, DEFAULT_MATCH_PREFERENCES, undefined, {
    logger: () => {},
    sessionFactory: async () => session
  });

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].appleMusicId, "account-winner");
  assert.equal(report.results[1].status, "ambiguous");
  assert.deepEqual(isrcLookups, ["WINNER"]);
  assert.equal(closeCount, 1);
});

test("matching closes the shared session after track failures", async () => {
  let closeCount = 0;
  const session = fakeSession({
    search: async () => {
      throw new Error("catalog unavailable");
    },
    close: async () => {
      closeCount += 1;
    }
  });
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "failed-job-cleanup",
    tracks: [
      {
        originalName: "Song",
        artists: ["Artist"],
        source: { provider: "qq", raw: {} }
      }
    ],
    raw: {}
  };

  const report = await matchAppleMusic(playlist, DEFAULT_MATCH_PREFERENCES, undefined, {
    logger: () => {},
    sessionFactory: async () => session
  });

  assert.equal(report.results[0].status, "not_found");
  assert.match(report.results[0].reason ?? "", /catalog unavailable/);
  assert.equal(closeCount, 1);
});

test("manual selections resolve lazily and reuse their addable id", async () => {
  let isrcLookups = 0;
  const session = fakeSession({
    songsByIsrc: async (isrc) => {
      isrcLookups += 1;
      return [song("account-id", "Song", "Artist", isrc)];
    }
  });
  const report: AppleMatchReport = {
    provider: "netease",
    playlistId: "manual-bridge",
    results: [
      {
        track: {
          originalName: "Song",
          artists: ["Artist"],
          source: { provider: "netease", raw: {} }
        },
        status: "matched",
        selectionSource: "manual",
        selectedId: "native-id",
        appleMusicId: "native-id",
        candidates: [
          {
            id: "native-id",
            name: "Song",
            artistName: "Artist",
            score: 1,
            storefront: "jp",
            isrc: "MANUAL"
          }
        ]
      }
    ]
  };

  assert.deepEqual(await resolveAppleMusicTrackIds(report, "us", session), ["account-id"]);
  assert.deepEqual(await resolveAppleMusicTrackIds(report, "us", session), ["account-id"]);
  assert.equal(isrcLookups, 1);
  assert.equal(report.results[0].candidates?.[0].addableId, "account-id");
});

test("playlist creation bridges manual selections and creates through one session", async () => {
  let factoryCalls = 0;
  let closeCount = 0;
  const createdWith: string[][] = [];
  const session = fakeSession({
    songsByIsrc: async (isrc) => [song("account-id", "Song", "Artist", isrc)],
    createPlaylist: async (_name, _description, trackIds) => {
      createdWith.push(trackIds);
      return "new-playlist";
    },
    close: async () => {
      closeCount += 1;
    }
  });
  const report: AppleMatchReport = {
    provider: "netease",
    results: [
      {
        track: {
          originalName: "Song",
          artists: ["Artist"],
          source: { provider: "netease", raw: {} }
        },
        status: "matched",
        selectionSource: "manual",
        selectedId: "native-id",
        appleMusicId: "native-id",
        candidates: [
          {
            id: "native-id",
            name: "Song",
            artistName: "Artist",
            score: 1,
            storefront: "jp",
            isrc: "MANUAL"
          }
        ]
      }
    ]
  };

  const playlistId = await createAppleMusicPlaylistFromReport(
    report,
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us" },
    "Playlist",
    "Description",
    {
      sessionFactory: async () => {
        factoryCalls += 1;
        return session;
      }
    }
  );

  assert.equal(playlistId, "new-playlist");
  assert.equal(factoryCalls, 1);
  assert.equal(closeCount, 1);
  assert.deepEqual(createdWith, [["account-id"]]);
});

test("job artwork comparator caches features by URL", async () => {
  const red = cover("red");
  const blue = cover("blue");
  const comparator = createArtworkComparator();
  const track = {
    originalName: "Song",
    artists: ["Artist"],
    albumCoverUrl: red,
    source: { provider: "qq" as const, raw: {} }
  };
  const candidates = [
    { id: "blue", name: "Song", artistName: "Artist", score: 1, artworkUrl: blue },
    { id: "red", name: "Song", artistName: "Artist", score: 1, artworkUrl: red }
  ];

  try {
    assert.equal((await comparator.choose(track, candidates))?.candidate.id, "red");
    assert.equal((await comparator.choose(track, candidates))?.candidate.id, "red");
    assert.deepEqual(comparator.getStats(), {
      featureComputations: 2,
      cacheHits: 4
    });
  } finally {
    await comparator.close();
  }
});
