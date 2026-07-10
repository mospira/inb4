import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIP_NOTIFICATION_DELAY_MS } from "../shared/constants";
import { createSpikeNotification, parseNotificationLogin } from "./notifications";

describe("createSpikeNotification", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("delays clipped notifications before using clip copy", async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockResolvedValue("notification-id");
    vi.stubGlobal("chrome", {
      notifications: {
        create
      },
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`
      }
    });

    const notification = createSpikeNotification("summit1g", true);

    await vi.advanceTimersByTimeAsync(CLIP_NOTIFICATION_DELAY_MS - 1);
    expect(create).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(notification).resolves.toBe("notification-id");

    expect(create).toHaveBeenCalledWith(
      expect.stringMatching(/^inb4:summit1g:\d+$/),
      expect.objectContaining({
        title: "inb4: summit1g",
        message: "Something exciting is happening! Click here to see a clip."
      })
    );
    expect(create.mock.calls[0][1].message).not.toContain("/min");
    expect(create.mock.calls[0][1].message).not.toContain("standard deviation");
  });

  it("uses generic copy when no clip was created", async () => {
    const create = vi.fn().mockResolvedValue("notification-id");
    vi.stubGlobal("chrome", {
      notifications: {
        create
      },
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`
      }
    });

    await createSpikeNotification("summit1g", false);

    expect(create.mock.calls[0][1].message).toBe(
      "Something exciting is happening!"
    );
  });
});

describe("parseNotificationLogin", () => {
  it("extracts normalized Twitch logins from notification IDs", () => {
    expect(parseNotificationLogin("inb4:Summit1G:123")).toBe("summit1g");
  });

  it("returns null for unrelated notifications", () => {
    expect(parseNotificationLogin("other")).toBeNull();
  });
});
