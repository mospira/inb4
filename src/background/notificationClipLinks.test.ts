import { describe, expect, it } from "vitest";
import {
  createNotificationClipLink,
  pruneNotificationClipLinks,
  readNotificationClipUrl
} from "./notificationClipLinks";

describe("notificationClipLinks", () => {
  it("creates expiring clip links", () => {
    expect(createNotificationClipLink("https://clips.twitch.tv/abc", 1_000)).toEqual({
      url: "https://clips.twitch.tv/abc",
      expiresAt: 86_401_000
    });
  });

  it("reads unexpired links by notification id", () => {
    expect(
      readNotificationClipUrl(
        {
          "notification-id": {
            url: "https://clips.twitch.tv/abc",
            expiresAt: 2_000
          }
        },
        "notification-id",
        1_999
      )
    ).toBe("https://clips.twitch.tv/abc");
  });

  it("prunes expired links", () => {
    expect(
      pruneNotificationClipLinks(
        {
          old: {
            url: "https://clips.twitch.tv/old",
            expiresAt: 1_000
          },
          fresh: {
            url: "https://clips.twitch.tv/fresh",
            expiresAt: 2_000
          }
        },
        1_500
      )
    ).toEqual({
      fresh: {
        url: "https://clips.twitch.tv/fresh",
        expiresAt: 2_000
      }
    });
  });
});
