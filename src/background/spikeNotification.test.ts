import { describe, expect, it, vi } from "vitest";
import { notifySpikeWithOptionalClip } from "./spikeNotification";

describe("notifySpikeWithOptionalClip", () => {
  it("sends a clipped notification and returns the clip URL when clip creation succeeds", async () => {
    const createNotification = vi.fn().mockResolvedValue("notification-id");

    await expect(
      notifySpikeWithOptionalClip({
        login: "summit1g",
        createClip: vi.fn().mockResolvedValue({
          id: "clip-id",
          editUrl: "https://www.twitch.tv/edit/clip-id"
        }),
        createNotification,
        getClipUrl: (clipId) => `https://clips.twitch.tv/${clipId}`
      })
    ).resolves.toEqual({
      notificationId: "notification-id",
      clipUrl: "https://clips.twitch.tv/clip-id"
    });

    expect(createNotification).toHaveBeenCalledWith("summit1g", true);
  });

  it("falls back to a plain notification when optional clip creation returns null", async () => {
    const createNotification = vi.fn().mockResolvedValue("notification-id");

    await expect(
      notifySpikeWithOptionalClip({
        login: "summit1g",
        createClip: vi.fn().mockResolvedValue(null),
        createNotification
      })
    ).resolves.toEqual({
      notificationId: "notification-id"
    });

    expect(createNotification).toHaveBeenCalledWith("summit1g", false);
  });

  it("falls back to a plain notification when optional clip creation throws", async () => {
    const createNotification = vi.fn().mockResolvedValue("notification-id");

    await expect(
      notifySpikeWithOptionalClip({
        login: "summit1g",
        createClip: vi.fn().mockRejectedValue(new Error("Twitch rejected clip creation.")),
        createNotification
      })
    ).resolves.toEqual({
      notificationId: "notification-id"
    });

    expect(createNotification).toHaveBeenCalledWith("summit1g", false);
  });
});
