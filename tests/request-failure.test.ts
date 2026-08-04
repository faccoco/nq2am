import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyLegacyAppleRequestFailure, normalizeLegacyAppleRequestFailures } from "../src/apple/requestFailure.js";
import type { AppleMatchReport, AppleMatchResult, NormalizedTrack } from "../src/types.js";

const track: NormalizedTrack = {
  originalName: "Song",
  artists: ["Artist"],
  source: { provider: "qq", raw: {} }
};

function legacyResult(reason: string, selectionSource?: "manual"): AppleMatchResult {
  return {
    track,
    status: "not_found",
    candidates: [],
    reason,
    ...(selectionSource ? { selectionSource } : {})
  };
}

test("legacy request failure classifier recognizes only request diagnostics", () => {
  assert.deepEqual(
    classifyLegacyAppleRequestFailure('Apple Music API 429: {"errors":[{"title":"Too Many Requests","status":"429"}]}'),
    { kind: "rate_limited", status: 429 }
  );
  assert.deepEqual(classifyLegacyAppleRequestFailure("apiRequestContext.fetch: Timeout 15000ms exceeded"), {
    kind: "timeout"
  });
  assert.deepEqual(
    classifyLegacyAppleRequestFailure("apiRequestContext.fetch: Target page, context or browser has been closed"),
    { kind: "session" }
  );
  assert.equal(classifyLegacyAppleRequestFailure("No results from Apple Music search"), undefined);
  assert.equal(classifyLegacyAppleRequestFailure("Best match score 0.42 below threshold 0.70"), undefined);
  assert.equal(classifyLegacyAppleRequestFailure("Marked as no match"), undefined);
  assert.equal(classifyLegacyAppleRequestFailure("Unrecognized catalog note"), undefined);
});

test("legacy report normalization is selective and idempotent", () => {
  const report: AppleMatchReport = {
    provider: "qq",
    results: [
      legacyResult("Apple Music API 503: unavailable"),
      legacyResult("No results from Apple Music search"),
      legacyResult("Best match score 0.42 below threshold 0.70"),
      legacyResult("Marked as no match", "manual"),
      legacyResult("Unrecognized catalog note")
    ]
  };

  const normalized = normalizeLegacyAppleRequestFailures(report);
  assert.notEqual(normalized, report);
  assert.deepEqual(
    normalized.results.map((result) => result.status),
    ["request_failed", "not_found", "score_rejected", "not_found", "not_found"]
  );
  assert.equal(normalized.results[0].reason, report.results[0].reason);
  assert.deepEqual(normalized.results[0].requestFailure, { kind: "http", status: 503 });
  assert.equal(normalizeLegacyAppleRequestFailures(normalized), normalized);
});

test("task loading persists legacy request-failure migration", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nq2am-request-failure-state-"));
  process.env.NQ2AM_DATA_DIR = dataDir;
  const storePath = join(dataDir, "tasks.json");
  const results = [
    legacyResult("Apple Music API 429: Too Many Requests"),
    legacyResult("apiRequestContext.fetch: Timeout 15000ms exceeded"),
    legacyResult("apiRequestContext.fetch: Target page, context or browser has been closed"),
    legacyResult("No results from Apple Music search"),
    legacyResult("Best match score 0.42 below threshold 0.70"),
    legacyResult("Marked as no match", "manual"),
    legacyResult("Unrecognized catalog note")
  ];
  writeFileSync(
    storePath,
    JSON.stringify([
      {
        key: "legacy",
        provider: "qq",
        name: "Legacy",
        createdAt: 1,
        updatedAt: 1,
        status: "matched",
        playlist: {
          provider: "qq",
          id: "legacy",
          name: "Legacy",
          tracks: results.map((result) => result.track),
          raw: {}
        },
        matchReport: {
          provider: "qq",
          playlistId: "legacy",
          playlistName: "Legacy",
          results
        }
      }
    ])
  );

  const { getTask } = await import("../server/state.js");
  const task = await getTask("legacy");
  assert.deepEqual(
    task?.matchReport?.results.map((result) => result.status),
    ["request_failed", "request_failed", "request_failed", "not_found", "score_rejected", "not_found", "not_found"]
  );

  let persisted: Array<{ matchReport?: AppleMatchReport }> = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    persisted = JSON.parse(readFileSync(storePath, "utf8")) as Array<{ matchReport?: AppleMatchReport }>;
    if (persisted[0]?.matchReport?.results[0]?.status === "request_failed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(
    persisted[0]?.matchReport?.results.map((result) => result.status),
    ["request_failed", "request_failed", "request_failed", "not_found", "score_rejected", "not_found", "not_found"]
  );
});
