import type { AppleMatchReport, AppleRequestFailure, AppleRequestOperation } from "../types.js";

type FailureHints = {
  operation?: AppleRequestOperation;
  status?: number;
  attempts?: number;
};

export class AppleRequestExecutionError extends Error {
  readonly name = "AppleRequestExecutionError";

  constructor(
    message: string,
    readonly requestFailure: AppleRequestFailure
  ) {
    super(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusFromMessage(message: string): number | undefined {
  const match = message.match(/Apple Music API\s+(\d{3})\b/iu);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function failureKind(message: string, status?: number): AppleRequestFailure["kind"] {
  if (status === 429) return "rate_limited";
  if (status !== undefined) return "http";
  if (/timed?\s*out|timeout(?:ed)?|Timeout \d+ms exceeded/iu.test(message)) return "timeout";
  if (
    /target (?:page, )?context or browser has been closed|targetclosederror|request context (?:has been )?(?:closed|disposed)|Apple Music API session is closed/iu.test(
      message
    )
  ) {
    return "session";
  }
  if (
    /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b|fetch failed|network error|socket hang up/iu.test(
      message
    )
  ) {
    return "network";
  }
  return "unknown";
}

export function describeAppleRequestFailure(
  error: unknown,
  hints: FailureHints = {}
): { reason: string; requestFailure: AppleRequestFailure } {
  if (error instanceof AppleRequestExecutionError) {
    return { reason: error.message, requestFailure: error.requestFailure };
  }

  const reason = errorMessage(error);
  const status = hints.status ?? statusFromMessage(reason);
  return {
    reason,
    requestFailure: {
      kind: failureKind(reason, status),
      ...(hints.operation ? { operation: hints.operation } : {}),
      ...(status === undefined ? {} : { status }),
      ...(hints.attempts === undefined ? {} : { attempts: hints.attempts })
    }
  };
}

export function wrapAppleRequestFailure(error: unknown, hints: FailureHints): AppleRequestExecutionError {
  const described = describeAppleRequestFailure(error, hints);
  return new AppleRequestExecutionError(described.reason, described.requestFailure);
}

export function classifyLegacyAppleRequestFailure(reason: string | undefined): AppleRequestFailure | undefined {
  if (!reason) return undefined;

  const status = statusFromMessage(reason);
  const isKnownRequestFailure =
    status !== undefined ||
    /apiRequestContext\.fetch|page\.goto: Timeout \d+ms exceeded|target (?:page, )?context or browser has been closed|targetclosederror|request context (?:has been )?(?:closed|disposed)|Apple Music API session is closed|timed out obtaining Apple Music developer token|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b|fetch failed|network error|socket hang up/iu.test(
      reason
    );
  if (!isKnownRequestFailure) return undefined;

  return {
    kind: failureKind(reason, status),
    ...(status === undefined ? {} : { status })
  };
}

export function normalizeLegacyAppleRequestFailures(report: AppleMatchReport): AppleMatchReport {
  let changed = false;
  const results = report.results.map((result) => {
    if (result.status !== "not_found") return result;

    const requestFailure = classifyLegacyAppleRequestFailure(result.reason);
    if (!requestFailure) return result;

    changed = true;
    return {
      ...result,
      status: "request_failed" as const,
      requestFailure
    };
  });

  return changed ? { ...report, results } : report;
}
