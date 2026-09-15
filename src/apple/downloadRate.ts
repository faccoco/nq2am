export type DownloadRateSample = { at: number; bytes: number };

const WINDOW_MS = 5000;
const MIN_WINDOW_MS = 400;
const CACHE_JUMP_BYTES = 256 * 1024;

export function nextDownloadRate(
  samples: readonly DownloadRateSample[],
  at: number,
  bytes: number,
  bytesTotal?: number
): { samples: DownloadRateSample[]; bytesPerSecond?: number; etaSeconds?: number } {
  const nextSamples = appendRateSample(samples, at, bytes);
  const bytesPerSecond = rateFromSamples(nextSamples);
  const remaining = bytesTotal && bytesTotal > bytes ? bytesTotal - bytes : undefined;
  const etaSeconds = bytesPerSecond && remaining ? Math.max(1, Math.round(remaining / bytesPerSecond)) : undefined;
  return { samples: nextSamples, bytesPerSecond, etaSeconds };
}

function appendRateSample(samples: readonly DownloadRateSample[], at: number, bytes: number): DownloadRateSample[] {
  const last = samples.at(-1);
  if (!last) return [{ at, bytes }];
  const dt = at - last.at;
  const db = bytes - last.bytes;
  if (db < 0 || (db > CACHE_JUMP_BYTES && dt < 200)) return [{ at, bytes }];
  if (dt <= 0) {
    const copy = samples.slice(0, -1);
    copy.push({ at: last.at, bytes: Math.max(last.bytes, bytes) });
    return copy;
  }
  const next = [...samples, { at, bytes }].filter((sample) => at - sample.at <= WINDOW_MS);
  return next.length > 0 ? next : [{ at, bytes }];
}

function rateFromSamples(samples: readonly DownloadRateSample[]): number | undefined {
  if (samples.length < 2) return undefined;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return undefined;
  const dt = (last.at - first.at) / 1000;
  if (dt < MIN_WINDOW_MS / 1000) return undefined;
  const db = last.bytes - first.bytes;
  if (db <= 0) return undefined;
  return db / dt;
}
