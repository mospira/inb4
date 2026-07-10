import { describe, expect, it, vi } from "vitest";
import type { StoredAuth, TwitchClip } from "../shared/types";
import { waitForClipAvailability } from "./clipVerification";

const auth: StoredAuth = {
  accessToken: "token",
  expiresAt: Date.now() + 1000,
  userId: "viewer-id",
  login: "viewer",
  scopes: ["user:read:chat", "clips:edit"],
  connectedAt: Date.now()
};

const clip = {
  id: "clip-id",
  url: "https://clips.twitch.tv/clip-id",
  created_at: "2026-07-09T00:00:00Z"
} as TwitchClip;

describe("waitForClipAvailability", () => {
  it("returns immediately when Get Clips finds the created clip", async () => {
    const getClip = vi.fn().mockResolvedValue(clip);
    const wait = vi.fn();

    await expect(
      waitForClipAvailability("clip-id", auth, {
        getClip,
        wait
      })
    ).resolves.toBe(clip);

    expect(getClip).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("polls until Get Clips returns the created clip", async () => {
    let currentTime = 0;
    const getClip = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(clip);
    const wait = vi.fn().mockImplementation(async (delayMs: number) => {
      currentTime += delayMs;
    });

    await expect(
      waitForClipAvailability("clip-id", auth, {
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
        getClip,
        wait,
        now: () => currentTime
      })
    ).resolves.toBe(clip);

    expect(getClip).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("returns null when the clip is not available before timeout", async () => {
    let currentTime = 0;
    const getClip = vi.fn().mockResolvedValue(null);
    const wait = vi.fn().mockImplementation(async (delayMs: number) => {
      currentTime += delayMs;
    });

    await expect(
      waitForClipAvailability("clip-id", auth, {
        timeoutMs: 2_500,
        pollIntervalMs: 1_000,
        getClip,
        wait,
        now: () => currentTime
      })
    ).resolves.toBeNull();

    expect(currentTime).toBe(2_500);
    expect(getClip).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenLastCalledWith(500);
  });
});
