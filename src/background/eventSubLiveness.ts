import {
  DEFAULT_EVENTSUB_KEEPALIVE_TIMEOUT_SECONDS,
  EVENTSUB_LIVENESS_GRACE_MS
} from "../shared/constants";

export function getEventSubKeepaliveTimeoutSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_EVENTSUB_KEEPALIVE_TIMEOUT_SECONDS;
}

export function isEventSubLivenessExpired({
  lastMessageAt,
  keepaliveTimeoutSeconds,
  now = Date.now(),
  graceMs = EVENTSUB_LIVENESS_GRACE_MS
}: {
  lastMessageAt: number | undefined;
  keepaliveTimeoutSeconds: number | undefined;
  now?: number;
  graceMs?: number;
}): boolean {
  if (!lastMessageAt) {
    return false;
  }

  const timeoutSeconds =
    keepaliveTimeoutSeconds ?? DEFAULT_EVENTSUB_KEEPALIVE_TIMEOUT_SECONDS;

  return now - lastMessageAt > timeoutSeconds * 1000 + graceMs;
}
