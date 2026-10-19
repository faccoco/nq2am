import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppleMatchReport, NormalizedPlaylist } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-apple-route-test-"));

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: (req: unknown, res: unknown) => unknown }[];
  };
};

type RouteResult = {
  statusCode: number;
  jsonBody: unknown;
};

async function seedMatchedTask(
  suffix: string,
  metadata: { name?: string; description?: string } = {}
): Promise<string> {
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: `apple-route-${suffix}`,
    ...metadata,
    tracks: [
      {
        originalName: "Song",
        artists: ["Artist"],
        source: { provider: "qq", raw: {} }
      }
    ],
    raw: {}
  };
  const report: AppleMatchReport = {
    provider: playlist.provider,
    playlistId: playlist.id,
    playlistName: playlist.name,
    results: [
      {
        track: playlist.tracks[0],
        status: "matched",
        selectedId: "song-1",
        appleMusicId: "song-1",
        candidates: [{ id: "song-1", name: "Song", artistName: "Artist", score: 1 }]
      }
    ]
  };
  const { addPlaylist, setMatchReport } = await import("../server/state.js");
  const key = await addPlaylist(playlist);
  setMatchReport(key, report);
  return key;
}

async function invokeCreateRoute(
  body: unknown,
  createPlaylist: Parameters<typeof import("../server/routes/apple.js")["createAppleRouter"]>[0]
): Promise<RouteResult> {
  const { createAppleRouter } = await import("../server/routes/apple.js");
  const router = createAppleRouter(createPlaylist) as unknown as { stack: RouteLayer[] };
  const layer = router.stack.find((item) => item.route?.path === "/create-playlist" && item.route.methods.post);
  assert.ok(layer?.route, "create-playlist route should exist");

  let statusCode = 200;
  let jsonBody: unknown;
  const req = { body };
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      jsonBody = data;
      return res;
    }
  };

  await layer.route.stack[0].handle(req, res);
  return { statusCode, jsonBody };
}

test("Apple playlist route submits edited name and description", async () => {
  const key = await seedMatchedTask("edited", {
    name: "Source name",
    description: "Source description"
  });
  const calls: { name: string; description: string }[] = [];

  const result = await invokeCreateRoute(
    {
      playlistId: key,
      name: "  Edited name  ",
      description: "  Edited description  "
    },
    async (_report, _prefs, name, description) => {
      calls.push({ name, description });
      return "apple-playlist-edited";
    }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.jsonBody, { playlistId: "apple-playlist-edited" });
  assert.deepEqual(calls, [{ name: "Edited name", description: "Edited description" }]);
});

test("Apple playlist route falls back to source metadata when fields are omitted", async () => {
  const key = await seedMatchedTask("source-defaults", {
    name: "  Source name  ",
    description: "  Source description  "
  });
  const calls: { name: string; description: string }[] = [];

  const result = await invokeCreateRoute({ playlistId: key }, async (_report, _prefs, name, description) => {
    calls.push({ name, description });
    return "apple-playlist-defaults";
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, [{ name: "Source name", description: "Source description" }]);
});

test("Apple playlist route uses stable fallbacks when source metadata is missing", async () => {
  const key = await seedMatchedTask("stable-defaults");
  const calls: { name: string; description: string }[] = [];

  const result = await invokeCreateRoute({ playlistId: key }, async (_report, _prefs, name, description) => {
    calls.push({ name, description });
    return "apple-playlist-stable";
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, [{ name: "Imported Playlist", description: "" }]);
});

for (const [label, body] of [
  ["empty name", { name: "   " }],
  ["non-string name", { name: 42 }],
  ["non-string description", { description: false }]
] as const) {
  test(`Apple playlist route rejects ${label} without changing task status`, async () => {
    const key = await seedMatchedTask(`invalid-${label.replaceAll(" ", "-")}`, {
      name: "Source name",
      description: "Source description"
    });
    let createCalls = 0;

    const result = await invokeCreateRoute({ playlistId: key, ...body }, async () => {
      createCalls += 1;
      return "unexpected";
    });
    const { getTask } = await import("../server/state.js");

    assert.equal(result.statusCode, 400);
    assert.equal(createCalls, 0);
    assert.equal((await getTask(key))?.status, "matched");
  });
}
