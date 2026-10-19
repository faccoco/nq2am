import { mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

// The dump hosts are plain file servers, not the MusicBrainz web service, so they want no courtesy
// identification. A project-specific User-Agent only makes this traffic easy to single out, so the
// dump requests go out with Node's default instead.

const SEGMENT_SIZE = 8 * 1024 * 1024;
const DEFAULT_CONNECTIONS = 6;
const MAX_CONNECTIONS = 16;
const PROGRESS_INTERVAL_MS = 200;
const STREAM_BUFFER = 1024 * 1024;
const MAX_SEGMENT_ATTEMPTS = 8;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 15_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** A dump host refusing or dropping one range request. The segment keeps its bytes and is retried. */
class TransientSegmentError extends Error {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "TransientSegmentError";
    this.retryAfterMs = retryAfterMs;
  }
}

export type DumpCacheMeta = {
  url: string;
  etag?: string;
  lastModified?: string;
  total?: number;
  segmentSize?: number;
  completed?: number[];
  partial?: Record<string, number>;
};

export type ResumableDownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (received: number, total?: number) => void;
  /** Test seam. Real downloads use their own transport so each segment gets its own socket. */
  fetchImpl?: typeof fetch;
  /** Parallel range requests. The dump hosts throttle each TCP stream, so several streams are far faster. */
  connections?: number;
  segmentSize?: number;
};

type DownloadState = {
  completed: Set<number>;
  partial: Map<number, number>;
  etag?: string;
  lastModified?: string;
  total?: number;
};

type DumpResponse = {
  status: number;
  header: (name: string) => string | undefined;
  body?: AsyncIterable<Buffer>;
  discard: () => Promise<void>;
};

type DumpTransport = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<DumpResponse>;

const MAX_REDIRECTS = 5;

/**
 * Range requests must each get their own socket. Node's global fetch pool funnels every request for
 * an origin onto one keep-alive connection, and because the dump hosts throttle per connection that
 * collapses parallel segments back to single-stream speed. A throwaway agent per request avoids it.
 */
function nodeTransport(): DumpTransport {
  return async (url, init) => {
    for (let redirects = 0; ; redirects += 1) {
      const response = await sendOnce(url, init);
      const location = response.header("location");
      if (!isRedirect(response.status) || !location || redirects >= MAX_REDIRECTS) return response;
      await response.discard();
      url = new URL(location, url).toString();
    }
  };
}

function sendOnce(
  url: string,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }
): Promise<DumpResponse> {
  return new Promise((resolve, reject) => {
    const secure = new URL(url).protocol === "https:";
    const send = secure ? httpsRequest : httpRequest;
    const Agent = secure ? HttpsAgent : HttpAgent;
    const agent = new Agent({ keepAlive: false, maxSockets: 1 });
    const request = send(
      url,
      { method: init.method ?? "GET", headers: init.headers, agent, signal: init.signal },
      (message) => {
        resolve({
          status: message.statusCode ?? 0,
          header: (name) => singleHeader(message.headers[name.toLowerCase()]),
          body: init.method === "HEAD" ? undefined : message,
          discard: async () => {
            message.resume();
            message.destroy();
          }
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function fetchTransport(fetchImpl: typeof fetch): DumpTransport {
  return async (url, init) => {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      signal: init.signal
    });
    // Reading through a Readable locks the web stream, so discarding has to go through the Readable.
    const body = response.body
      ? Readable.fromWeb(response.body as import("node:stream/web").ReadableStream, {
          highWaterMark: STREAM_BUFFER
        })
      : undefined;
    return {
      status: response.status,
      header: (name) => response.headers.get(name) ?? undefined,
      body: body as AsyncIterable<Buffer> | undefined,
      discard: async () => {
        if (body) body.destroy();
        else await response.body?.cancel().catch(() => undefined);
      }
    };
  };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function downloadResumableFile(
  url: string,
  destPath: string,
  options: ResumableDownloadOptions = {}
): Promise<string> {
  const transport = options.fetchImpl ? fetchTransport(options.fetchImpl) : nodeTransport();
  const segmentSize = Math.max(1, options.segmentSize ?? SEGMENT_SIZE);
  const connections = Math.max(1, Math.min(MAX_CONNECTIONS, options.connections ?? defaultConnections()));
  const metaPath = `${destPath}.meta.json`;
  await mkdir(dirname(destPath), { recursive: true });

  let meta = await readDumpMeta(metaPath);
  if (meta && meta.url !== url) {
    await resetDownload(destPath, metaPath);
    meta = undefined;
  }

  const localSize = await fileSize(destPath);
  if (meta && isLocallyComplete(meta, localSize)) {
    if (await remoteUnchanged(transport, url, meta, options.signal)) {
      const size = meta.total ?? localSize;
      options.onProgress?.(size, size);
      return destPath;
    }
    await resetDownload(destPath, metaPath);
    meta = undefined;
  }

  const state = restoreState(meta, segmentSize, localSize);
  const firstIndex = nextIncompleteSegment(state, 0);
  const firstStart = firstIndex * segmentSize + (state.partial.get(firstIndex) ?? 0);
  const firstEnd = firstIndex * segmentSize + segmentSize - 1;
  const response = await openFirstRange(transport, url, firstStart, firstEnd, state, options.signal);

  if (response.status === 416) {
    await response.discard();
    const size = await fileSize(destPath);
    if (size > 0 && state.total && size >= state.total) {
      options.onProgress?.(size, state.total);
      return destPath;
    }
    await resetDownload(destPath, metaPath);
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  if (response.status !== 200 && response.status !== 206) {
    await response.discard();
    throw new Error(`Failed to download ${url} (${response.status})`);
  }

  const etag = response.header("etag") ?? state.etag;
  const lastModified = response.header("last-modified") ?? state.lastModified;
  const contentRange = parseContentRange(response.header("content-range"));
  const total =
    response.status === 206 ? (contentRange?.total ?? state.total) : positiveLength(response.header("content-length"));

  // The server ignored Range, so the response body is the whole file and prior bytes are worthless.
  const restarted = response.status !== 206;
  if (restarted) {
    state.completed.clear();
    state.partial.clear();
  }

  await ensureFile(destPath);
  const handle = await open(destPath, "r+");
  const base: DumpCacheMeta = { url, etag, lastModified, total, segmentSize };
  const persist = async (): Promise<void> => {
    await writeFile(metaPath, JSON.stringify({ ...base, ...serializeState(state) }), "utf8");
  };
  const reportProgress = (): void => {
    options.onProgress?.(receivedBytes(state, segmentSize, total), total);
  };
  const timer = setInterval(reportProgress, PROGRESS_INTERVAL_MS);

  try {
    if (restarted) {
      await handle.truncate(0);
      await persist();
      await writeResponseAt(handle, response, 0, options.signal, (written) => {
        state.partial.set(0, written);
      });
      state.partial.clear();
      if (total) markAllComplete(state, total, segmentSize);
    } else {
      if (total) await handle.truncate(total);
      await persist();
      await downloadSegments({
        url,
        transport,
        handle,
        state,
        segmentSize,
        connections,
        total,
        firstIndex,
        firstResponse: response,
        signal: options.signal,
        persist
      });
    }
  } catch (error) {
    await persist().catch(() => undefined);
    throw error;
  } finally {
    clearInterval(timer);
    await handle.close().catch(() => undefined);
  }

  const received = await fileSize(destPath);
  options.onProgress?.(total ?? received, total ?? received);
  if (total && received < total) throw new Error(`Download incomplete (${received} / ${total})`);
  await persist();
  return destPath;
}

type SegmentJob = {
  url: string;
  transport: DumpTransport;
  handle: Awaited<ReturnType<typeof open>>;
  state: DownloadState;
  segmentSize: number;
  connections: number;
  total?: number;
  firstIndex: number;
  firstResponse: DumpResponse;
  signal?: AbortSignal;
  persist: () => Promise<void>;
};

async function downloadSegments(job: SegmentJob): Promise<void> {
  const { state, segmentSize, total } = job;
  const count = total ? Math.ceil(total / segmentSize) : job.firstIndex + 1;
  const queue: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!state.completed.has(index)) queue.push(index);
  }
  if (!queue.includes(job.firstIndex)) queue.unshift(job.firstIndex);
  queue.sort((a, b) => (a === job.firstIndex ? -1 : b === job.firstIndex ? 1 : a - b));

  let initial: DumpResponse | undefined = job.firstResponse;
  const attempts = new Map<number, number>();
  // Every worker must issue its first request in the same tick: the HTTP pool only opens a fresh
  // socket per simultaneous request, and reuses one connection when requests trickle in. Since each
  // dump host throttles per connection, staggered starts collapse back to single-stream throughput.
  const worker = async (): Promise<void> => {
    for (;;) {
      throwIfAborted(job.signal);
      const index = queue.shift();
      if (index === undefined) return;
      try {
        let response: DumpResponse;
        if (initial && index === job.firstIndex) {
          response = initial;
          initial = undefined;
        } else {
          response = await fetchSegment(job, index);
        }
        await writeSegment(job, index, response);
        attempts.delete(index);
      } catch (error) {
        const transient = asTransient(error);
        if (!transient) throw error;
        const tries = (attempts.get(index) ?? 0) + 1;
        attempts.set(index, tries);
        if (tries >= MAX_SEGMENT_ATTEMPTS) throw error;
        queue.push(index);
        await delay(transient.retryAfterMs ?? backoffMs(tries), job.signal);
      }
    }
  };

  const workerCount = Math.max(1, Math.min(job.connections, queue.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/** The opening request doubles as a probe for total size and Range support, so retry it through hiccups. */
async function openFirstRange(
  transport: DumpTransport,
  url: string,
  start: number,
  end: number,
  state: DownloadState,
  signal?: AbortSignal
): Promise<DumpResponse> {
  for (let tries = 1; ; tries += 1) {
    throwIfAborted(signal);
    let response: DumpResponse;
    try {
      response = await transport(url, { signal, headers: rangeHeaders(start, end, state) });
    } catch (error) {
      if (isAbortError(error) || tries >= MAX_SEGMENT_ATTEMPTS) throw error;
      await delay(backoffMs(tries), signal);
      continue;
    }
    if (!RETRYABLE_STATUS.has(response.status)) return response;
    await response.discard();
    if (tries >= MAX_SEGMENT_ATTEMPTS) {
      throw new Error(`Failed to download ${url} (${response.status})`);
    }
    await delay(retryAfterMs(response) ?? backoffMs(tries), signal);
  }
}

async function fetchSegment(job: SegmentJob, index: number): Promise<DumpResponse> {
  const { state, segmentSize } = job;
  const start = index * segmentSize + (state.partial.get(index) ?? 0);
  const end = index * segmentSize + segmentLength(index, segmentSize, job.total) - 1;
  let response: DumpResponse;
  try {
    response = await job.transport(job.url, {
      signal: job.signal,
      headers: rangeHeaders(start, end, state)
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new TransientSegmentError(`Segment ${index} request failed: ${describeError(error)}`);
  }
  if (response.status === 206) return response;
  await response.discard();
  if (RETRYABLE_STATUS.has(response.status)) {
    throw new TransientSegmentError(`Segment ${index} was refused (${response.status})`, retryAfterMs(response));
  }
  if (response.status === 200) {
    throw new Error(`Remote dump stopped honoring Range requests (segment ${index} returned 200)`);
  }
  throw new Error(`Failed to download segment ${index} (${response.status})`);
}

async function writeSegment(job: SegmentJob, index: number, response: DumpResponse): Promise<void> {
  const { state, segmentSize } = job;
  const segmentStart = index * segmentSize;
  const offset = state.partial.get(index) ?? 0;
  try {
    await writeResponseAt(job.handle, response, segmentStart + offset, job.signal, (written) => {
      state.partial.set(index, offset + written);
    });
  } catch (error) {
    await job.persist();
    if (isAbortError(error)) throw error;
    throw new TransientSegmentError(`Segment ${index} transfer failed: ${describeError(error)}`);
  }
  const expected = segmentLength(index, segmentSize, job.total);
  const written = state.partial.get(index) ?? 0;
  await job.persist();
  if (written < expected) {
    throw new TransientSegmentError(`Segment ${index} ended early (${written} / ${expected})`);
  }
  state.completed.add(index);
  state.partial.delete(index);
  await job.persist();
}

async function writeResponseAt(
  handle: Awaited<ReturnType<typeof open>>,
  response: DumpResponse,
  position: number,
  signal: AbortSignal | undefined,
  onWritten: (written: number) => void
): Promise<void> {
  if (!response.body) return;
  let written = 0;
  try {
    for await (const chunk of response.body) {
      throwIfAborted(signal);
      await handle.write(chunk, 0, chunk.byteLength, position + written);
      written += chunk.byteLength;
      onWritten(written);
    }
  } finally {
    await response.discard();
  }
}

export function aliasDumpCacheDir(dataDir: string): string {
  return join(dataDir, "alias-dumps");
}

export async function pruneDumpCache(dir: string, keepNames: readonly string[], prefix?: string): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const keep = new Set(keepNames);
  for (const name of names) {
    const base = name.endsWith(".meta.json") ? name.slice(0, -".meta.json".length) : name;
    if (prefix && !base.startsWith(prefix) && !name.startsWith(prefix)) continue;
    if (keep.has(base) || keep.has(name)) continue;
    await unlinkQuiet(join(dir, name));
  }
}

function defaultConnections(): number {
  const raw = Number(process.env.NQ2AM_DUMP_CONNECTIONS);
  if (Number.isFinite(raw) && raw >= 1 && raw <= MAX_CONNECTIONS) return Math.floor(raw);
  return DEFAULT_CONNECTIONS;
}

function rangeHeaders(start: number, end: number, state: DownloadState): Record<string, string> {
  const headers: Record<string, string> = { range: `bytes=${start}-${end}` };
  if (state.etag) headers["if-range"] = state.etag;
  else if (state.lastModified) headers["if-range"] = state.lastModified;
  return headers;
}

function segmentLength(index: number, segmentSize: number, total?: number): number {
  if (!total) return segmentSize;
  return Math.min(segmentSize, Math.max(0, total - index * segmentSize));
}

function nextIncompleteSegment(state: DownloadState, from: number): number {
  let index = from;
  while (state.completed.has(index)) index += 1;
  return index;
}

function receivedBytes(state: DownloadState, segmentSize: number, total?: number): number {
  let sum = 0;
  for (const index of state.completed) sum += segmentLength(index, segmentSize, total);
  for (const bytes of state.partial.values()) sum += bytes;
  return total ? Math.min(sum, total) : sum;
}

function markAllComplete(state: DownloadState, total: number, segmentSize: number): void {
  const count = Math.ceil(total / segmentSize);
  for (let index = 0; index < count; index += 1) state.completed.add(index);
}

function serializeState(state: DownloadState): Pick<DumpCacheMeta, "completed" | "partial"> {
  const partial: Record<string, number> = {};
  for (const [index, bytes] of state.partial) {
    if (bytes > 0) partial[String(index)] = bytes;
  }
  return { completed: [...state.completed].sort((a, b) => a - b), partial };
}

function restoreState(meta: DumpCacheMeta | undefined, segmentSize: number, localSize: number): DownloadState {
  const state: DownloadState = { completed: new Set(), partial: new Map() };
  if (!meta) return state;
  state.etag = meta.etag;
  state.lastModified = meta.lastModified;
  state.total = meta.total;
  if (meta.segmentSize === segmentSize) {
    for (const index of meta.completed ?? []) state.completed.add(index);
    for (const [index, bytes] of Object.entries(meta.partial ?? {})) {
      const parsed = Number(index);
      if (Number.isInteger(parsed) && bytes > 0) state.partial.set(parsed, bytes);
    }
    return state;
  }
  if (meta.segmentSize === undefined && localSize > 0) {
    // Contiguous file from an older single-stream download: keep the whole segments it already covers.
    const whole = Math.floor(localSize / segmentSize);
    for (let index = 0; index < whole; index += 1) state.completed.add(index);
    const rest = localSize % segmentSize;
    if (rest > 0) state.partial.set(whole, rest);
  }
  return state;
}

function isLocallyComplete(meta: DumpCacheMeta, localSize: number): boolean {
  if (!meta.total || localSize < meta.total) return false;
  if (!meta.segmentSize || !meta.completed) return true;
  return meta.completed.length >= Math.ceil(meta.total / meta.segmentSize);
}

async function remoteUnchanged(
  transport: DumpTransport,
  url: string,
  meta: DumpCacheMeta,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const response = await transport(url, { method: "HEAD", signal });
    await response.discard();
    if (response.status < 200 || response.status >= 300) return true;
    const etag = response.header("etag");
    if (etag && meta.etag) return etag === meta.etag;
    const lastModified = response.header("last-modified");
    if (lastModified && meta.lastModified) return lastModified === meta.lastModified;
    const length = positiveLength(response.header("content-length"));
    if (length && meta.total) return length === meta.total;
    return true;
  } catch {
    return true;
  }
}

async function readDumpMeta(path: string): Promise<DumpCacheMeta | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as DumpCacheMeta;
    if (!parsed || typeof parsed.url !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function ensureFile(path: string): Promise<void> {
  const handle = await open(path, "a");
  await handle.close();
}

async function resetDownload(destPath: string, metaPath: string): Promise<void> {
  await unlinkQuiet(destPath);
  await unlinkQuiet(metaPath);
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function unlinkQuiet(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore
  }
}

function parseContentRange(value: string | undefined): { start: number; total?: number } | undefined {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/iu.exec(value ?? "");
  if (!match) return undefined;
  return {
    start: Number(match[1]),
    total: match[3] === "*" ? undefined : Number(match[3])
  };
}

function positiveLength(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw abortError();
}

function abortError(): Error {
  const error = new Error("Download cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function asTransient(error: unknown): TransientSegmentError | undefined {
  if (isAbortError(error)) return undefined;
  return error instanceof TransientSegmentError ? error : undefined;
}

function backoffMs(tries: number): number {
  const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (tries - 1));
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

function retryAfterMs(response: DumpResponse): number | undefined {
  const raw = response.header("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RETRY_CAP_MS, seconds * 1000);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.min(RETRY_CAP_MS, Math.max(0, at - Date.now()));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
