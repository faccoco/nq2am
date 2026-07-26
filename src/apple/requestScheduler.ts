export type RequestSchedulerOptions = {
  minIntervalMs: number;
  randomPauseMinMs?: number;
  randomPauseMaxMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

export class RequestStartScheduler {
  private tail: Promise<void> = Promise.resolve();
  private nextStartAt = 0;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly randomPauseMinMs: number;
  private readonly randomPauseMaxMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(
    private readonly minIntervalMs: number,
    options: Omit<RequestSchedulerOptions, "minIntervalMs"> = {}
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.randomPauseMinMs = Math.max(0, options.randomPauseMinMs ?? 0);
    this.randomPauseMaxMs = Math.max(this.randomPauseMinMs, options.randomPauseMaxMs ?? 0);
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const turnComplete = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = turnComplete;

    await previous;
    try {
      const delayMs = Math.max(0, this.nextStartAt - this.now());
      if (delayMs > 0) {
        await this.sleep(delayMs);
      }
      this.nextStartAt = this.now() + Math.max(0, this.minIntervalMs) + this.nextRandomPauseMs();
    } finally {
      release();
    }

    return operation();
  }

  deferNextStart(delayMs: number): void {
    this.nextStartAt = Math.max(this.nextStartAt, this.now() + Math.max(0, delayMs));
  }

  private nextRandomPauseMs(): number {
    if (this.randomPauseMaxMs <= this.randomPauseMinMs) {
      return this.randomPauseMinMs;
    }
    return this.randomPauseMinMs + Math.floor(this.random() * (this.randomPauseMaxMs - this.randomPauseMinMs + 1));
  }
}

export type RetryOptions = {
  maxAttempts: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  beforeRetry?: (error: unknown, attempt: number) => Promise<void> | void;
};

export async function runWithRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !options.shouldRetry(error, attempt)) {
        throw error;
      }
      await options.beforeRetry?.(error, attempt);
    }
  }

  throw lastError;
}
