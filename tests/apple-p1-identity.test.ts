import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppleSong } from "../src/apple/api.js";
import {
  artistAliasCatalogPath,
  artistAliasCatalogRefreshPromise,
  cancelArtistAliasCatalogDownload,
  getArtistAliasCatalogStatus,
  musicBrainzSnapshotDate,
  requestArtistAliasCatalogRefresh
} from "../src/apple/artistAliasCatalog.js";
import { emptyArtistAliasSnapshot, setLoadedArtistAliasSnapshot } from "../src/apple/artistAliasIndex.js";
import {
  areApprovedArtistAliases,
  compareArtistCredits,
  compileArtistAliasGroups,
  detectStorefrontForTrack,
  extraNativeStorefrontsForTrack,
  foldHanToSimplified,
  identityCompactText,
  loadArtistAliasCatalogSnapshot,
  matchSingleTrack,
  parseVocadbArtistDump,
  queryPlanForTrack,
  recordingTextSimilarity,
  refreshArtistAliasCatalog,
  runWithArtistAliasSnapshot,
  snapshotFromCatalogFile,
  TOUHOUDB_ATTRIBUTION,
  UTAITEDB_ATTRIBUTION,
  VOCADB_ATTRIBUTION
} from "../src/index.js";
import { DEFAULT_MATCH_PREFERENCES, type NormalizedTrack } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-p1-"));

function song(id: string, name: string, artistName: string, durationInMillis: number): AppleSong {
  return {
    id,
    type: "songs",
    attributes: { name, artistName, albumName: "Album", durationInMillis }
  };
}

function track(
  name: string,
  artists: string[],
  provider: NormalizedTrack["source"]["provider"] = "qq"
): NormalizedTrack {
  return { originalName: name, artists, durationMs: 180_000, source: { provider, raw: {} } };
}

function abortPromise(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => {
      const error = new Error("Download cancelled");
      error.name = "AbortError";
      reject(error);
    };
    if (!signal) {
      reject(new Error("missing abort signal"));
      return;
    }
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function zipStore(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const localEntry = Buffer.concat([local, data]);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    locals.push(localEntry);
    centrals.push(central);
    offset += localEntry.length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

test("simplified and traditional Han fold together without an alias group", () => {
  assert.equal(foldHanToSimplified("高橋優"), "高桥优");
  assert.equal(identityCompactText("高橋優"), identityCompactText("高桥优"));
  assert.equal(recordingTextSimilarity("一樣的月光", "一样的月光"), 1);
  const artist = compareArtistCredits(["高桥优"], ["高橋優"]);
  assert.equal(artist.primaryPair, 1);
  assert.equal(artist.aliases.length, 0);
  assert.equal(areApprovedArtistAliases("高桥优", "高橋優"), false);
});

test("bundled aliases still work before any catalog refresh", () => {
  setLoadedArtistAliasSnapshot(emptyArtistAliasSnapshot());
  assert.equal(areApprovedArtistAliases("初音ミク", "Hatsune Miku"), true);
  assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), false);
});

test("catalog dump names share one entity after compile", () => {
  const groups = compileArtistAliasGroups({
    vocadbArtists: [
      {
        translatedName: { japanese: "まらしぃ", romaji: "marasy", english: "marasy" },
        names: [
          { language: "Japanese", value: "まらしぃ" },
          { language: "Romaji", value: "marasy" }
        ]
      }
    ]
  });
  assert.ok(groups.some((group) => group.includes(identityCompactText("まらしぃ")) && group.includes("marasy")));
  const snapshot = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    groups
  });
  runWithArtistAliasSnapshot(snapshot, () => {
    assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), true);
  });
});

test("search hints, legal names, unspecified names, and converters are not aliases", () => {
  const groups = compileArtistAliasGroups({
    musicbrainzArtists: [
      {
        name: "まらしぃ",
        aliases: [
          { name: "marasy", type: "Search hint", locale: "en" },
          { name: "Sato", type: "Legal name", locale: "en" }
        ]
      }
    ],
    vocadbArtists: [
      {
        names: [
          { language: "Japanese", value: "ラマーズP" },
          { language: "Unspecified", value: "LamazeP" }
        ]
      }
    ]
  });
  assert.equal(
    groups.some((group) => group.includes(identityCompactText("まらしぃ")) && group.includes("marasy")),
    false
  );
  assert.equal(
    groups.some((group) => group.includes(identityCompactText("ラマーズP")) && group.includes("lamazep")),
    false
  );
  assert.equal(areApprovedArtistAliases("まらしぃ", "marashii"), false);
});

test("distinct catalog entities stay distinct", () => {
  const groups = compileArtistAliasGroups({
    vocadbArtists: [
      { translatedName: { japanese: "紫咲ほたる", english: "Hotaru Murasaki" } },
      { translatedName: { japanese: "EastNewSound", english: "East New Sound" } }
    ]
  });
  const snapshot = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    groups
  });
  runWithArtistAliasSnapshot(snapshot, () => {
    assert.equal(areApprovedArtistAliases("紫咲ほたる", "EastNewSound"), false);
  });
});

test("an artist collected by several sources stays usable", () => {
  const pair = [identityCompactText("まらしぃ"), "marasy"];
  const snapshot = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    // MusicBrainz, VocaDB, UtaiteDB and TouhouDB each contribute their own group for one artist.
    groups: [pair, pair, pair, [...pair, "marasyhompage"]]
  });
  runWithArtistAliasSnapshot(snapshot, () => {
    assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), true);
  });
});

test("a name reused by different entities stays unusable", () => {
  const snapshot = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    groups: [
      ["tiger", identityCompactText("タイガー")],
      ["tiger", "thetigers"]
    ]
  });
  runWithArtistAliasSnapshot(snapshot, () => {
    assert.equal(areApprovedArtistAliases("tiger", "タイガー"), false);
    assert.equal(areApprovedArtistAliases("tiger", "the tigers"), false);
    assert.equal(areApprovedArtistAliases("タイガー", "the tigers"), false);
  });
});

test("VocaDB attribution is recorded and dump parser reads artist json", () => {
  assert.match(VOCADB_ATTRIBUTION, /CC BY 4\.0/);
  assert.match(UTAITEDB_ATTRIBUTION, /UtaiteDB/);
  assert.match(TOUHOUDB_ATTRIBUTION, /TouhouDB/);
  const zip = zipStore({
    "Artists/1.json": JSON.stringify({
      translatedName: { japanese: "ダズビー", romaji: "DAZBEE", english: "DAZBEE" }
    })
  });
  const artists = parseVocadbArtistDump(zip);
  assert.equal(artists.length, 1);
  assert.ok(compileArtistAliasGroups({ vocadbArtists: artists }).length >= 1);
});

test("catalog download compiles MusicBrainz plus VocaDB family dumps", async () => {
  await refreshArtistAliasCatalog({
    fetchMusicBrainzArtistDump: async () =>
      Buffer.from(`${JSON.stringify({ name: "米津玄師", "sort-name": "Yonezu Kenshi" })}\n`),
    fetchVocadbDump: async () =>
      zipStore({
        "Artists/1.json": JSON.stringify({ translatedName: { japanese: "まらしぃ", romaji: "marasy" } })
      }),
    fetchUtaitedbDump: async () =>
      zipStore({
        "Artists/2.json": JSON.stringify({ translatedName: { japanese: "ダズビー", romaji: "DAZBEE" } })
      }),
    fetchTouhoudbDump: async () =>
      zipStore({
        "Artists/3.json": JSON.stringify({ translatedName: { japanese: "凋叶棕", romaji: "RD-Sounds" } })
      })
  });
  const stored = JSON.parse(await readFile(artistAliasCatalogPath(), "utf8")) as {
    sources: Array<{ id: string }>;
    sourceCounts?: Record<string, number>;
  };
  assert.deepEqual(
    stored.sources.map((source) => source.id),
    ["musicbrainz", "vocadb", "utaitedb", "touhoudb"]
  );
  assert.equal(stored.sourceCounts?.musicbrainz, 1);
  assert.equal(stored.sourceCounts?.vocadb, 1);
  assert.equal(stored.sourceCounts?.utaitedb, 1);
  assert.equal(stored.sourceCounts?.touhoudb, 1);
  await loadArtistAliasCatalogSnapshot();
  assert.equal(areApprovedArtistAliases("米津玄師", "Yonezu Kenshi"), true);
  assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), true);
  assert.equal(areApprovedArtistAliases("ダズビー", "DAZBEE"), true);
  assert.equal(areApprovedArtistAliases("凋叶棕", "RD-Sounds"), true);
});

test("catalog dumps download one source at a time", async () => {
  const order: string[] = [];
  await refreshArtistAliasCatalog({
    fetchMusicBrainzArtistDump: async () => {
      order.push("musicbrainz-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("musicbrainz-end");
      return Buffer.from(`${JSON.stringify({ name: "米津玄師", "sort-name": "Yonezu Kenshi" })}\n`);
    },
    fetchVocadbDump: async () => {
      order.push("vocadb-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("vocadb-end");
      return zipStore({
        "Artists/1.json": JSON.stringify({ translatedName: { japanese: "まらしぃ", romaji: "marasy" } })
      });
    },
    fetchUtaitedbDump: async () => {
      order.push("utaitedb-start");
      return zipStore({});
    },
    fetchTouhoudbDump: async () => {
      order.push("touhoudb-start");
      return zipStore({});
    }
  });
  assert.deepEqual(order, [
    "musicbrainz-start",
    "musicbrainz-end",
    "vocadb-start",
    "vocadb-end",
    "utaitedb-start",
    "touhoudb-start"
  ]);
});

test("refresh failure keeps the previous catalog index", async () => {
  const previous = {
    version: 1 as const,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    groups: [[identityCompactText("まらしぃ"), "marasy"]]
  };
  await writeFile(artistAliasCatalogPath(), JSON.stringify(previous), "utf8");
  await loadArtistAliasCatalogSnapshot();
  await assert.rejects(() =>
    refreshArtistAliasCatalog({
      fetchMusicBrainzArtistDump: async () => {
        throw new Error("network down");
      },
      fetchVocadbDump: async () => new Uint8Array()
    })
  );
  const stored = JSON.parse(await readFile(artistAliasCatalogPath(), "utf8")) as { refreshedAt: string };
  assert.equal(stored.refreshedAt, previous.refreshedAt);
  assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), true);
});

test("MusicBrainz dump folder names become a calendar dump date", () => {
  assert.equal(musicBrainzSnapshotDate("20260903-000000"), "2026-09-03");
  assert.equal(musicBrainzSnapshotDate("latest"), undefined);
});

test("catalog download reports progress and cancel keeps the previous index", async () => {
  const previous = {
    version: 1 as const,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    dumpDate: "2025-12-01",
    sources: [],
    groups: [[identityCompactText("まらしぃ"), "marasy"]]
  };
  await writeFile(artistAliasCatalogPath(), JSON.stringify(previous), "utf8");
  await loadArtistAliasCatalogSnapshot();

  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const started = requestArtistAliasCatalogRefresh({
    fetchMusicBrainzArtistDump: async (ctx) => {
      ctx?.onDumpDate?.("2026-09-03");
      ctx?.onProgress?.("musicbrainz", 40, 100);
      await Promise.race([gate, abortPromise(ctx?.signal)]);
      return new Uint8Array();
    },
    fetchVocadbDump: async () => {
      throw new Error("vocadb should not start until musicbrainz finishes");
    }
  });
  assert.equal(started, "started");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const mid = getArtistAliasCatalogStatus();
  assert.equal(mid.status, "downloading");
  assert.equal(mid.progress?.bytesReceived, 40);
  assert.equal(mid.progress?.bytesTotal, 100);
  assert.equal(mid.progress?.percent, 40);
  assert.equal(mid.progress?.currentSource, "musicbrainz");
  assert.equal(mid.refreshedAt, previous.refreshedAt);

  const pending = artistAliasCatalogRefreshPromise();
  assert.equal(cancelArtistAliasCatalogDownload(), true);
  await assert.rejects(() => pending ?? Promise.resolve());
  resume();

  const stored = JSON.parse(await readFile(artistAliasCatalogPath(), "utf8")) as {
    refreshedAt: string;
    dumpDate?: string;
  };
  assert.equal(stored.refreshedAt, previous.refreshedAt);
  assert.equal(stored.dumpDate, previous.dumpDate);
  const after = getArtistAliasCatalogStatus();
  assert.equal(after.status, "idle");
  assert.equal(after.refreshedAt, previous.refreshedAt);
  assert.equal(after.dumpDate, previous.dumpDate);
  assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), true);
});

test("successful catalog download stores the dump date", async () => {
  await refreshArtistAliasCatalog({
    fetchMusicBrainzArtistDump: async (ctx) => {
      ctx?.onDumpDate?.("2026-09-03");
      return new Uint8Array();
    },
    fetchVocadbDump: async () => zipStore({})
  });
  const stored = JSON.parse(await readFile(artistAliasCatalogPath(), "utf8")) as {
    dumpDate?: string;
    refreshedAt?: string;
  };
  assert.equal(stored.dumpDate, "2026-09-03");
  assert.ok(stored.refreshedAt);
  assert.equal(getArtistAliasCatalogStatus().dumpDate, "2026-09-03");
});

test("catalog compile can use a local MusicBrainz dump path", async () => {
  const dataDir = process.env.NQ2AM_DATA_DIR;
  assert.ok(dataDir);
  const dumpPath = join(dataDir, "mb-artist.jsonl");
  await writeFile(dumpPath, `${JSON.stringify({ name: "米津玄師", "sort-name": "Yonezu Kenshi" })}\n`);
  await refreshArtistAliasCatalog({
    fetchMusicBrainzArtistDump: async (ctx) => {
      ctx?.onLocalPath?.("musicbrainz", dumpPath);
      return new Uint8Array();
    },
    fetchVocadbDump: async () => zipStore({})
  });
  await loadArtistAliasCatalogSnapshot();
  assert.equal(areApprovedArtistAliases("米津玄師", "Yonezu Kenshi"), true);
});

test("in-flight snapshot ignores a later catalog replacement", () => {
  const first = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "a",
    sources: [],
    groups: [[identityCompactText("まらしぃ"), "marasy"]]
  });
  const second = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "b",
    sources: [],
    groups: [[identityCompactText("まらしぃ"), "othername"]]
  });
  setLoadedArtistAliasSnapshot(second);
  runWithArtistAliasSnapshot(first, () => {
    assert.equal(areApprovedArtistAliases("まらしぃ", "marasy"), true);
    assert.equal(areApprovedArtistAliases("まらしぃ", "othername"), false);
  });
});

test("catalog aliases can auto-match まらしぃ to marasy", async () => {
  const snapshot = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    groups: [[identityCompactText("まらしぃ"), "marasy"]]
  });
  const result = await runWithArtistAliasSnapshot(snapshot, () =>
    matchSingleTrack(
      track("Goodbye-bye", ["まらしぃ"]),
      [song("marasy", "Goodbye-bye", "marasy", 180_000)],
      "us",
      DEFAULT_MATCH_PREFERENCES
    )
  );
  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "marasy");
  assert.ok(result.candidates?.[0]?.evidence?.artist.hasPrimaryRelationship);
});

test("Han-only titles from QQ still search JP", () => {
  const source = track("炎", ["LiSA"], "qq");
  assert.equal(detectStorefrontForTrack(source, "source"), "cn");
  assert.deepEqual(extraNativeStorefrontsForTrack(source), ["jp"]);
  const plan = queryPlanForTrack(
    source,
    "us",
    { ...DEFAULT_MATCH_PREFERENCES, nativeSearch: true, cjkDetection: "source" },
    detectStorefrontForTrack
  );
  assert.ok(plan.some((query) => query.storefront === "cn"));
  assert.ok(plan.some((query) => query.storefront === "jp" && !query.fallback));
  assert.ok(plan.some((query) => query.fallback && query.storefront === "us"));
  assert.equal(detectStorefrontForTrack(track("名前のない怪物", ["EGOIST"]), "source"), "jp");
  assert.equal(detectStorefrontForTrack(track("봄날", ["BTS"]), "source"), "kr");
});

test("no-ISRC grouping uses an 8-12s window and does not merge different recordings", async () => {
  const close = await matchSingleTrack(
    track("Song", ["Artist"]),
    [song("single", "Song", "Artist", 180_000), song("album", "Song", "Artist", 190_000)],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(close.recordingGroups?.length, 1);

  const vanished = await matchSingleTrack(
    track("初音ミクの消失", ["cosMo@暴走P"]),
    [
      song("vanish", "初音ミクの消失", "cosMo@Bousou-P", 180_000),
      song("runaway", "初音ミクの暴走", "cosMo@Bousou-P", 188_000)
    ],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.ok((vanished.recordingGroups?.length ?? 0) >= 2);
});
