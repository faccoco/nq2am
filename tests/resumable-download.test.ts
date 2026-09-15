import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nextDownloadRate } from "../src/apple/downloadRate.js";
import { downloadResumableFile } from "../src/apple/resumableDownload.js";

type Handler = (request: Request) => Response | Promise<Response>;

function recordingFetch(handler: Handler): { fetchImpl: typeof fetch; requests: Request[] } {
  const requests: Request[] = [];
  const fetchImpl = (async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return handler(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function partial(body: string, start: number, end: number, total: number): Response {
  const slice = body.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      "content-range": `bytes ${start}-${start + slice.length - 1}/${total}`,
      "content-length": String(slice.length),
      etag: '"v1"'
    }
  });
}

function requestedRange(request: Request): { start: number; end: number } {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.get("range") ?? "");
  assert.ok(match, `expected a bounded range, got ${request.headers.get("range")}`);
  return { start: Number(match[1]), end: Number(match[2]) };
}

test("resumable download only refetches the segments it is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  const body = "0123456789";
  await writeFile(dest, body.slice(0, 4));
  await writeFile(
    `${dest}.meta.json`,
    JSON.stringify({ url: "https://example.test/dump.bin", total: 10, etag: '"v1"' })
  );

  const { fetchImpl, requests } = recordingFetch((request) => {
    assert.equal(request.method, "GET");
    // Dump requests must not advertise a project-specific User-Agent.
    assert.equal(request.headers.get("user-agent"), null);
    assert.equal(request.headers.get("if-range"), '"v1"');
    const { start, end } = requestedRange(request);
    return partial(body, start, end, body.length);
  });

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl,
    segmentSize: 4,
    connections: 1
  });

  assert.equal(await readFile(dest, "utf8"), body);
  assert.deepEqual(
    requests.map((request) => request.headers.get("range")),
    ["bytes=4-7", "bytes=8-9"]
  );
});

test("resumable download fetches segments over parallel connections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  const body = "AAAABBBBCCCCDDDD";

  let inFlight = 0;
  let peak = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let seen = 0;
  const { fetchImpl, requests } = recordingFetch(async (request) => {
    const { start, end } = requestedRange(request);
    seen += 1;
    // The opening request must return before any worker starts, so it never joins the barrier.
    if (seen > 1) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Hold each segment open until the last worker has joined, proving the fetches overlap.
      // The timeout only has to outlast the staggered worker start-up.
      if (inFlight >= 3) release();
      await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, 4000))]);
      inFlight -= 1;
    }
    return partial(body, start, end, body.length);
  });

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl,
    segmentSize: 4,
    connections: 4
  });

  assert.equal(await readFile(dest, "utf8"), body);
  assert.equal(requests.length, 4);
  assert.ok(peak >= 3, `expected overlapping segment fetches, peak was ${peak}`);
});

test("an aborted download keeps partial segment bytes for the next attempt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  const body = "0123456789ab";
  const controller = new AbortController();

  const first = recordingFetch((request) => {
    const { start } = requestedRange(request);
    // Deliver the first segment, then cancel before the rest can be requested.
    if (start === 0) return partial(body, 0, 3, body.length);
    controller.abort();
    return partial(body, start, start, body.length);
  });

  await assert.rejects(
    () =>
      downloadResumableFile("https://example.test/dump.bin", dest, {
        fetchImpl: first.fetchImpl,
        segmentSize: 4,
        connections: 1,
        signal: controller.signal
      }),
    /cancel/i
  );

  const second = recordingFetch((request) => {
    const { start, end } = requestedRange(request);
    return partial(body, start, end, body.length);
  });

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl: second.fetchImpl,
    segmentSize: 4,
    connections: 1
  });

  assert.equal(await readFile(dest, "utf8"), body);
  // Segment 0 survived the cancel, so the retry never asks for bytes 0-3 again.
  assert.ok(
    second.requests.every((request) => request.headers.get("range") !== "bytes=0-3"),
    "retry refetched an already complete segment"
  );
});

test("a segment refused with 503 is retried instead of failing the download", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  const body = "0123456789ab";
  let refusals = 0;

  const { fetchImpl } = recordingFetch((request) => {
    const { start, end } = requestedRange(request);
    if (start === 4 && refusals < 2) {
      refusals += 1;
      return new Response("busy", { status: 503, headers: { "retry-after": "0" } });
    }
    return partial(body, start, end, body.length);
  });

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl,
    segmentSize: 4,
    connections: 1
  });

  assert.equal(refusals, 2);
  assert.equal(await readFile(dest, "utf8"), body);
});

test("a segment that ends early is refetched rather than leaving a hole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  const body = "0123456789ab";
  let truncated = false;

  const { fetchImpl } = recordingFetch((request) => {
    const { start, end } = requestedRange(request);
    if (start === 4 && !truncated) {
      truncated = true;
      // Two of the four bytes, as if the connection dropped mid-segment.
      return partial(body, start, start + 1, body.length);
    }
    return partial(body, start, end, body.length);
  });

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl,
    segmentSize: 4,
    connections: 1
  });

  assert.ok(truncated);
  assert.equal(await readFile(dest, "utf8"), body);
});

test("complete dump with matching etag skips the GET", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  await writeFile(dest, "0123456789");
  await writeFile(
    `${dest}.meta.json`,
    JSON.stringify({
      url: "https://example.test/dump.bin",
      total: 10,
      etag: '"v1"',
      segmentSize: 4,
      completed: [0, 1, 2]
    })
  );

  const { fetchImpl, requests } = recordingFetch((request) => {
    assert.equal(request.method, "HEAD");
    return new Response(null, { status: 200, headers: { etag: '"v1"', "content-length": "10" } });
  });

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl,
    segmentSize: 4
  });

  assert.equal(await readFile(dest, "utf8"), "0123456789");
  assert.equal(requests.length, 1);
});

test("a 200 response rewrites the file because the server ignored Range", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nq2am-resume-"));
  const dest = join(dir, "dump.bin");
  await writeFile(dest, "OLD!");
  await writeFile(`${dest}.meta.json`, JSON.stringify({ url: "https://example.test/dump.bin", total: 10 }));

  const { fetchImpl } = recordingFetch(
    () => new Response("abcdefghij", { status: 200, headers: { "content-length": "10" } })
  );

  await downloadResumableFile("https://example.test/dump.bin", dest, {
    fetchImpl,
    segmentSize: 4,
    connections: 2
  });

  assert.equal(await readFile(dest, "utf8"), "abcdefghij");
});

test("download rate ignores a cached-byte jump and then estimates eta", () => {
  const afterJump = nextDownloadRate([], 0, 1_500_000_000, 2_000_000_000);
  assert.equal(afterJump.bytesPerSecond, undefined);
  assert.equal(afterJump.etaSeconds, undefined);

  const flowing = nextDownloadRate(afterJump.samples, 1000, 1_510_000_000, 2_000_000_000);
  assert.ok(flowing.bytesPerSecond);
  assert.equal(Math.round(flowing.bytesPerSecond / 1_000_000), 10);
  assert.equal(flowing.etaSeconds, 49);
});
