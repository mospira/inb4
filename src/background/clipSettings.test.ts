import { describe, expect, it } from "vitest";
import type { StorageShape, StoredAuth } from "../shared/types";
import {
  requiresClipPermission,
  shouldCreateNotificationClip
} from "./clipSettings";

const auth: StoredAuth = {
  accessToken: "token",
  expiresAt: 1,
  userId: "viewer-id",
  login: "viewer",
  scopes: ["user:read:chat", "clips:edit"],
  connectedAt: 1
};

function createStorage(): StorageShape {
  return {
    auth,
    settings: {
      defaultCooldownSeconds: 600,
      notificationsEnabled: true,
      createClipsEnabled: false,
      globalSensitivity: "medium"
    },
    channels: {
      test: {
        login: "test",
        broadcasterUserId: "1",
        enabled: true,
        createClipsEnabled: true,
        sensitivity: "medium"
      }
    }
  };
}

describe("clip settings", () => {
  it("uses the channel setting even when the default is disabled", () => {
    const stored = createStorage();

    expect(
      shouldCreateNotificationClip(stored.channels.test, auth)
    ).toBe(true);
  });

  it("still requires the granted Twitch clip scope", () => {
    const stored = createStorage();

    expect(
      shouldCreateNotificationClip(stored.channels.test, {
        ...auth,
        scopes: ["user:read:chat"]
      })
    ).toBe(false);
  });

  it("requests clip permission when either a default or channel needs it", () => {
    const stored = createStorage();

    expect(requiresClipPermission(stored)).toBe(true);

    stored.channels.test.createClipsEnabled = false;
    stored.settings.createClipsEnabled = true;
    expect(requiresClipPermission(stored)).toBe(true);

    stored.settings.createClipsEnabled = false;
    expect(requiresClipPermission(stored)).toBe(false);
  });
});
