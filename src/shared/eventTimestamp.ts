import {
  EVENT_TIMESTAMP_FUTURE_TOLERANCE_MS,
  EVENT_TIMESTAMP_MAX_AGE_MS
} from "./constants";

export function resolveEventTimestamp(
  timestamp: unknown,
  receivedAt = Date.now()
): number | null {
  if (typeof timestamp !== "string") {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed < receivedAt - EVENT_TIMESTAMP_MAX_AGE_MS) {
    return null;
  }

  if (parsed > receivedAt + EVENT_TIMESTAMP_FUTURE_TOLERANCE_MS) {
    return null;
  }

  return Math.min(parsed, receivedAt);
}
