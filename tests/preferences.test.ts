import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_MATCH_PREFERENCES } from "../src/types.js";

const dataDir = mkdtempSync(join(tmpdir(), "nq2am-preferences-test-"));
process.env.NQ2AM_DATA_DIR = dataDir;

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: (req: unknown, res: unknown) => unknown }[];
  };
};

async function invokePutPreferences(body: unknown) {
  const router = (await import("../server/routes/preferences.js")).default as unknown as {
    stack: RouteLayer[];
  };
  const layer = router.stack.find((item) => item.route?.path === "/preferences" && item.route.methods.put);
  assert.ok(layer?.route, "preferences PUT route should exist");

  let statusCode = 200;
  let jsonBody: unknown;
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

  await layer.route.stack[0].handle({ body }, res);
  return { statusCode, jsonBody };
}

test("legacy preferences receive configurable Apple request settings", async () => {
  const { setPreferences } = await import("../server/preferences.js");
  const prefs = await setPreferences({ threshold: 0.8 });

  assert.equal(prefs.threshold, 0.8);
  assert.equal(prefs.matchConcurrency, DEFAULT_MATCH_PREFERENCES.matchConcurrency);
  assert.equal(prefs.appleRequestIntervalMs, DEFAULT_MATCH_PREFERENCES.appleRequestIntervalMs);
  assert.equal(prefs.appleRequestTimeoutMs, DEFAULT_MATCH_PREFERENCES.appleRequestTimeoutMs);
  assert.equal(prefs.appleRandomPauseEnabled, true);
});

test("an explicitly disabled random pause remains disabled", async () => {
  const { setPreferences } = await import("../server/preferences.js");
  const prefs = await setPreferences({
    ...DEFAULT_MATCH_PREFERENCES,
    appleRandomPauseEnabled: false
  });

  assert.equal(prefs.appleRandomPauseEnabled, false);
});

test("invalid Apple request settings are rejected without changing stored preferences", async () => {
  const { getPreferences, PreferencesValidationError, setPreferences } = await import("../server/preferences.js");
  const valid = await setPreferences({
    ...DEFAULT_MATCH_PREFERENCES,
    matchConcurrency: 4,
    appleRequestIntervalMs: 500,
    appleRandomPauseEnabled: true,
    appleRandomPauseMinMs: 1_000,
    appleRandomPauseMaxMs: 5_000
  });
  const storedBefore = readFileSync(join(dataDir, "preferences.json"), "utf8");

  await assert.rejects(
    setPreferences({
      ...valid,
      appleRandomPauseMinMs: 5_000,
      appleRandomPauseMaxMs: 1_000
    }),
    PreferencesValidationError
  );
  await assert.rejects(setPreferences({ ...valid, matchConcurrency: 99 }), PreferencesValidationError);

  assert.deepEqual(await getPreferences(), valid);
  assert.equal(readFileSync(join(dataDir, "preferences.json"), "utf8"), storedBefore);
});

test("preferences route returns 400 and preserves configuration for invalid input", async () => {
  const { getPreferences } = await import("../server/preferences.js");
  const current = await getPreferences();
  const response = await invokePutPreferences({
    ...current,
    appleRandomPauseMinMs: 2_000,
    appleRandomPauseMaxMs: 1_000
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.jsonBody, {
    error: "appleRandomPauseMinMs must be less than or equal to appleRandomPauseMaxMs"
  });
  assert.deepEqual(await getPreferences(), current);
});
