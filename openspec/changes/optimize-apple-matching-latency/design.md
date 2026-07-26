## Context

Matching currently performs one track at a time. Every catalog operation creates
a browser context, navigates to `music.apple.com`, executes one API request, and
closes the context. A native-store search then resolves every retained candidate
through a serial ISRC lookup, even though only one candidate can be selected.
Cover tie-breaking independently launches another Chromium process.

The Apple web player token must still be captured from an authenticated browser
session, Apple rate limits are not formally documented for this access path, and
the persisted match-report format and scoring behavior must remain compatible.

## Goals / Non-Goals

**Goals:**

- Reduce Apple page navigation from once per request to at most once per
  matching job.
- Reduce cross-store ISRC lookups from every candidate to selected candidates.
- Allow independent tracks to make progress concurrently without issuing
  uncontrolled request bursts.
- Reuse and cache artwork resources for the duration of a job.
- Bound stalled operations and expose enough timing data to locate future
  bottlenecks.
- Preserve result order, progress reporting, scoring, ambiguity decisions,
  retries, and playlist creation.
- Let users tune concurrency, pacing, timeouts, and retries from Settings.
- Support an optional bounded random pause in the shared request scheduler.

**Non-Goals:**

- Changing metadata scoring, thresholds, or cover-similarity rules.
- Adding ML-based matching.
- Bypassing Apple authentication or attempting to defeat anti-automation
  controls.
- Persisting a browser context across server restarts or across user accounts.

## Decisions

### Use a task-scoped Apple API session

`createAppleApiSession` will load cookies once, create one browser context,
capture or reuse the MusicKit developer token, and send all job requests through
the context's request client. The context is closed in a `finally` block after
the job. Existing one-shot API exports remain as compatibility wrappers around
a short-lived session.

This keeps Apple authentication behavior centralized while eliminating repeated
page navigation. A permanent global context was rejected because logout, cookie
refresh, and concurrent jobs would have unclear ownership.

### Combine bounded track concurrency with one request scheduler

The matcher will use a user-configured worker pool while preserving results by
source index. The shared API session will serialize request start times through
a user-configured minimum interval, optionally add a random pause sampled from
a configured inclusive range, apply explicit request timeouts, and retry only
transient failures (`429`, selected `5xx`, and timeouts) with bounded backoff.
The first request does not receive an artificial pause. Random pacing is
additional to the fixed interval and never shortens `Retry-After` or backoff.

Unbounded `Promise.all` was rejected because a playlist can contain hundreds of
tracks. Keeping the old fully serial loop was rejected because network waits,
not scoring CPU, dominate normal jobs.

### Resolve ISRCs lazily

An automatically selected native-store candidate is bridged immediately so the
report remains ready for playlist creation. Ambiguous and not-found candidates
are not bridged. A manually selected candidate is bridged when playlist creation
collects final track IDs. Existing `addableId` values remain valid and are
reused.

This changes bridge complexity from retained candidates per track to selected
cross-store tracks while preserving manual review.

### Reuse artwork comparison resources per job

The artwork comparator will own a lazy Chromium page and a per-job cache keyed
by artwork URL. SVG data URLs continue to use the local fast path. Network
downloads retain an explicit timeout, and failures remain best-effort so they
cannot change an otherwise ambiguous result.

### Emit structured stage timings

Matching will emit JSON-line records to stderr with a stable prefix. Records
include job identity, stage, duration, request attempt/status where relevant,
and final request counts. The logging path is best-effort and does not alter
persisted reports or the HTTP API.

## Risks / Trade-offs

- **Apple rejects context request calls that previously ran in page
  JavaScript** -> Preserve the same authorization headers, user token, cookies,
  origin, and referer; keep one-shot wrappers and clear errors for rollback.
- **Concurrent requests trigger throttling** -> Limit workers, space request
  starts globally, honor `Retry-After`, and use bounded backoff.
- **A shared session fails mid-job** -> Convert failures to per-track
  `not_found` results as today and always close resources.
- **Progress callbacks complete out of source order** -> Report only the
  completed count during execution and place each result back at its original
  index.
- **Deferred manual bridging fails during playlist creation** -> Reuse the
  existing candidate ID fallback and report creation errors without losing the
  saved selection.

## Migration Plan

1. Add session, scheduler, artwork comparator, and worker-pool tests.
2. Route matching through the task-scoped implementations while retaining
   compatibility wrappers.
3. Route playlist creation through lazy selected-candidate bridging.
4. Compare structured request counts and total time on an existing playlist.
5. Roll back to the previous commit if Apple rejects context-level requests;
   persisted match reports require no migration.

## Open Questions

- If Apple exposes a stable batch ISRC endpoint for multiple values, bridging
  can be reduced further in a separate change.
