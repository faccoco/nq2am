import { performance } from "node:perf_hooks";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { loadCookies, saveCookies } from "../fetchers/auth.js";
import { RequestStartScheduler, runWithRetry } from "./requestScheduler.js";

export type AppleSong = {
  id: string;
  type: "songs";
  attributes: {
    name: string;
    artistName: string;
    albumName: string;
    durationInMillis?: number;
    releaseDate?: string;
    isrc?: string;
    url?: string;
    contentRating?: "explicit" | "clean";
    artwork?: {
      url?: string;
      width?: number;
      height?: number;
    };
  };
};

type SearchResponse = {
  results?: {
    songs?: {
      data: AppleSong[];
    };
  };
};

type StorefrontResponse = {
  data: { id: string }[];
};

type PlaylistResponse = {
  data: { id: string }[];
};

export type AppleApiOperation = "storefront" | "search" | "isrc" | "create_playlist";

export type AppleApiRequestMetric = {
  operation: AppleApiOperation;
  attempt: number;
  durationMs: number;
  outcome: "success" | "error";
  status?: number;
};

export type AppleApiSessionStats = {
  requestCount: number;
  retryCount: number;
};

export type AppleApiSessionOptions = {
  requestTimeoutMs?: number;
  minRequestIntervalMs?: number;
  randomPauseEnabled?: boolean;
  randomPauseMinMs?: number;
  randomPauseMaxMs?: number;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  onRequest?: (metric: AppleApiRequestMetric) => void;
};

export type AppleApiSession = {
  search(term: string, storefront: string): Promise<AppleSong[]>;
  songsByIsrc(isrc: string, storefront: string): Promise<AppleSong[]>;
  getStorefront(): Promise<string>;
  createPlaylist(name: string, description: string, trackIds: string[]): Promise<string>;
  getStats(): AppleApiSessionStats;
  close(): Promise<void>;
};

const TOKEN_CAPTURE_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_INTERVAL_MS = 150;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 750;

let sharedBrowser: Browser | undefined;
let sharedBrowserPromise: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) {
    return sharedBrowser;
  }

  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch({ headless: true })
      .then((browser) => {
        sharedBrowser = browser;
        return browser;
      })
      .finally(() => {
        sharedBrowserPromise = undefined;
      });
  }

  return sharedBrowserPromise;
}

let cachedDeveloperToken: string | undefined;
let tokenCapturePromise: Promise<string> | undefined;

async function captureDeveloperToken(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  let timer: NodeJS.Timeout | undefined;

  try {
    let settled = false;
    let resolveToken!: (token: string) => void;
    let rejectToken!: (error: Error) => void;
    const tokenPromise = new Promise<string>((resolve, reject) => {
      resolveToken = (token) => {
        if (!settled) {
          settled = true;
          resolve(token);
        }
      };
      rejectToken = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
    });

    timer = setTimeout(
      () => rejectToken(new Error("Timed out obtaining Apple Music developer token from the web player")),
      TOKEN_CAPTURE_TIMEOUT_MS
    );

    page.on("request", (request) => {
      const authorization = request.headers().authorization;
      if (request.url().includes("api.music.apple.com") && authorization?.startsWith("Bearer ")) {
        resolveToken(authorization.slice("Bearer ".length));
      }
    });

    await page.goto("https://music.apple.com/", {
      waitUntil: "domcontentloaded",
      timeout: TOKEN_CAPTURE_TIMEOUT_MS
    });

    void (async () => {
      while (!settled) {
        const token = await page
          .evaluate(() => {
            const browserWindow = window as unknown as {
              MusicKit?: { getInstance?: () => { developerToken?: string } | undefined };
            };
            try {
              const instance = browserWindow.MusicKit?.getInstance?.();
              if (instance?.developerToken) {
                return instance.developerToken;
              }
            } catch {
              // MusicKit is not ready yet.
            }

            const meta = document.querySelector('meta[name="desktop-music-app/config/environment"]');
            const content = meta?.getAttribute("content");
            if (!content) {
              return null;
            }

            try {
              const config = JSON.parse(decodeURIComponent(content)) as {
                MEDIA_API?: { token?: string };
              };
              return config.MEDIA_API?.token ?? null;
            } catch {
              return null;
            }
          })
          .catch(() => null);

        if (token) {
          resolveToken(token);
          return;
        }
        await page.waitForTimeout(500).catch(() => {});
      }
    })();

    return await tokenPromise;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    await page.close();
  }
}

async function getDeveloperToken(context: BrowserContext): Promise<string> {
  if (cachedDeveloperToken) {
    return cachedDeveloperToken;
  }

  if (!tokenCapturePromise) {
    tokenCapturePromise = captureDeveloperToken(context)
      .then((token) => {
        cachedDeveloperToken = token;
        return token;
      })
      .finally(() => {
        tokenCapturePromise = undefined;
      });
  }

  return tokenCapturePromise;
}

async function refreshDeveloperToken(context: BrowserContext, staleToken: string): Promise<string> {
  if (cachedDeveloperToken === staleToken) {
    cachedDeveloperToken = undefined;
  }
  return getDeveloperToken(context);
}

class AppleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "AppleApiError";
  }
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

function isRetryable(error: unknown, attempt: number): boolean {
  if (!(error instanceof AppleApiError)) {
    return true;
  }
  if (error.status === 401) {
    return attempt === 1;
  }
  return error.status === 429 || error.status >= 500;
}

class BrowserAppleApiSession implements AppleApiSession {
  private readonly scheduler: RequestStartScheduler;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly onRequest?: (metric: AppleApiRequestMetric) => void;
  private requestCount = 0;
  private retryCount = 0;
  private closed = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly mediaUserToken: string,
    private developerToken: string,
    options: AppleApiSessionOptions
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.onRequest = options.onRequest;
    this.scheduler = new RequestStartScheduler(options.minRequestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS, {
      randomPauseMinMs: options.randomPauseEnabled ? options.randomPauseMinMs : 0,
      randomPauseMaxMs: options.randomPauseEnabled ? options.randomPauseMaxMs : 0
    });
  }

  async search(term: string, storefront: string): Promise<AppleSong[]> {
    const params = new URLSearchParams({ types: "songs", term, limit: "15" });
    const result = await this.requestJson<SearchResponse>("search", `/v1/catalog/${storefront}/search?${params}`);
    return result.results?.songs?.data ?? [];
  }

  async songsByIsrc(isrc: string, storefront: string): Promise<AppleSong[]> {
    const params = new URLSearchParams({ "filter[isrc]": isrc, limit: "10" });
    const result = await this.requestJson<{ data?: AppleSong[] }>("isrc", `/v1/catalog/${storefront}/songs?${params}`);
    return result.data ?? [];
  }

  async getStorefront(): Promise<string> {
    const result = await this.requestJson<StorefrontResponse>("storefront", "/v1/me/storefront");
    return result.data?.[0]?.id ?? "us";
  }

  async createPlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
    const body = JSON.stringify({
      attributes: { name, description },
      relationships: {
        tracks: {
          data: trackIds.map((id) => ({ id, type: "songs" }))
        }
      }
    });
    const result = await this.requestJson<PlaylistResponse>("create_playlist", "/v1/me/library/playlists", {
      method: "POST",
      body
    });
    const id = result.data?.[0]?.id;
    if (!id) {
      throw new Error("Playlist creation returned no data");
    }
    return id;
  }

  getStats(): AppleApiSessionStats {
    return {
      requestCount: this.requestCount,
      retryCount: this.retryCount
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    try {
      await saveCookies("apple", await this.context.cookies()).catch(() => {});
    } finally {
      await this.context.close();
    }
  }

  private async requestJson<T>(
    operation: AppleApiOperation,
    path: string,
    init?: { method?: string; body?: string }
  ): Promise<T> {
    return runWithRetry(
      async (attempt) => {
        if (attempt > 1) {
          this.retryCount += 1;
        }
        this.requestCount += 1;

        const startedAt = performance.now();
        let status: number | undefined;
        try {
          const value = await this.scheduler.schedule(async () => {
            const response = await this.context.request.fetch(`https://amp-api.music.apple.com${path}`, {
              method: init?.method ?? "GET",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${this.developerToken}`,
                "Content-Type": "application/json",
                "Music-User-Token": this.mediaUserToken,
                Origin: "https://music.apple.com",
                Referer: "https://music.apple.com/"
              },
              ...(init?.body === undefined ? {} : { data: init.body }),
              failOnStatusCode: false,
              timeout: this.requestTimeoutMs
            });

            try {
              status = response.status();
              const text = await response.text();
              if (!response.ok()) {
                const retryAfterMs = parseRetryAfter(response.headers()["retry-after"]);
                throw new AppleApiError(status, `Apple Music API ${status}: ${text.slice(0, 200)}`, retryAfterMs);
              }
              return JSON.parse(text) as T;
            } finally {
              await response.dispose();
            }
          });

          this.onRequest?.({
            operation,
            attempt,
            durationMs: performance.now() - startedAt,
            outcome: "success",
            status
          });
          return value;
        } catch (error) {
          status = error instanceof AppleApiError ? error.status : status;
          this.onRequest?.({
            operation,
            attempt,
            durationMs: performance.now() - startedAt,
            outcome: "error",
            status
          });
          throw error;
        }
      },
      {
        maxAttempts: this.maxAttempts,
        shouldRetry: isRetryable,
        beforeRetry: async (error, attempt) => {
          if (error instanceof AppleApiError && error.status === 401) {
            this.developerToken = await refreshDeveloperToken(this.context, this.developerToken);
            return;
          }

          const retryAfterMs = error instanceof AppleApiError ? error.retryAfterMs : undefined;
          const backoffMs = retryAfterMs ?? this.baseRetryDelayMs * 2 ** (attempt - 1);
          this.scheduler.deferNextStart(backoffMs);
        }
      }
    );
  }
}

export async function createAppleApiSession(options: AppleApiSessionOptions = {}): Promise<AppleApiSession> {
  const cookies = await loadCookies("apple");
  if (!cookies || cookies.length === 0) {
    throw new Error("Not logged in to Apple Music. Please log in from Settings.");
  }

  const mediaUserToken = cookies.find((cookie) => cookie.name === "media-user-token")?.value;
  if (!mediaUserToken) {
    throw new Error("Apple Music session expired. Please log in again.");
  }

  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    await context.addCookies(cookies);
    const developerToken = await getDeveloperToken(context);
    return new BrowserAppleApiSession(context, mediaUserToken, developerToken, options);
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function withOneShotSession<T>(operation: (session: AppleApiSession) => Promise<T>): Promise<T> {
  const session = await createAppleApiSession();
  try {
    return await operation(session);
  } finally {
    await session.close();
  }
}

export async function appleSearch(term: string, storefront: string): Promise<AppleSong[]> {
  return withOneShotSession((session) => session.search(term, storefront));
}

export async function appleSongsByIsrc(isrc: string, storefront: string): Promise<AppleSong[]> {
  return withOneShotSession((session) => session.songsByIsrc(isrc, storefront));
}

export async function appleGetStorefront(): Promise<string> {
  return withOneShotSession((session) => session.getStorefront());
}

export async function appleCreatePlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  return withOneShotSession((session) => session.createPlaylist(name, description, trackIds));
}
