## 1. Apple Request Session

- [x] 1.1 Add a task-scoped Apple API session that reuses cookies, context, and developer token.
- [x] 1.2 Add request timeout, pacing, bounded transient retry, and request metrics.
- [x] 1.3 Preserve existing one-shot Apple API exports as compatibility wrappers.

## 2. Matching Execution

- [x] 2.1 Add an order-preserving bounded worker pool for playlist tracks.
- [x] 2.2 Route search and selected-candidate ISRC bridging through the shared session.
- [x] 2.3 Defer unresolved manual-candidate bridging until playlist creation.
- [x] 2.4 Emit structured stage timings and a final job summary.

## 3. Artwork Resources

- [x] 3.1 Add a job-scoped artwork comparator with lazy browser initialization.
- [x] 3.2 Cache artwork downloads and computed features by URL within the job.
- [x] 3.3 Preserve best-effort fallback and existing similarity thresholds.

## 4. Verification

- [x] 4.1 Add tests for worker concurrency, stable result ordering, and progress totals.
- [x] 4.2 Add tests for request pacing/retry and lazy selected-candidate ISRC lookup.
- [x] 4.3 Add tests for artwork feature caching and resource cleanup.
- [x] 4.4 Run OpenSpec validation, unit tests, lint, typecheck, and web build.

## 5. User-configurable pacing

- [x] 5.1 Persist and strictly validate concurrency, timeout, retry, pacing, and artwork settings.
- [x] 5.2 Add bilingual Settings UI controls and help text.
- [x] 5.3 Add optional bounded random pauses to the shared request scheduler.
- [x] 5.4 Add deterministic scheduler, runtime propagation, and migration tests.
