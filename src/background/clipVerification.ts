import {
  CLIP_VERIFICATION_POLL_INTERVAL_MS,
  CLIP_VERIFICATION_TIMEOUT_MS
} from "../shared/constants";
import type { StoredAuth, TwitchClip } from "../shared/types";
import { getClipById } from "./twitchApi";

interface ClipVerificationOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  getClip?: (clipId: string, auth: StoredAuth) => Promise<TwitchClip | null>;
  wait?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

export async function waitForClipAvailability(
  clipId: string,
  auth: StoredAuth,
  {
    timeoutMs = CLIP_VERIFICATION_TIMEOUT_MS,
    pollIntervalMs = CLIP_VERIFICATION_POLL_INTERVAL_MS,
    getClip = getClipById,
    wait = delay,
    now = Date.now
  }: ClipVerificationOptions = {}
): Promise<TwitchClip | null> {
  const deadline = now() + timeoutMs;

  while (true) {
    const clip = await getClip(clipId, auth);
    if (clip) {
      return clip;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return null;
    }

    await wait(Math.min(pollIntervalMs, remainingMs));
  }
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
