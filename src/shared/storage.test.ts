import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import { hydrateStorage } from "./storage";

describe("hydrateStorage", () => {
  it("applies defaults when local storage is empty", () => {
    expect(hydrateStorage({})).toEqual({
      auth: null,
      settings: DEFAULT_SETTINGS,
      channels: {}
    });
  });

  it("keeps stored settings while filling missing defaults", () => {
    expect(
      hydrateStorage({
        settings: {
          notificationsEnabled: false
        }
      }).settings
    ).toEqual({
      ...DEFAULT_SETTINGS,
      notificationsEnabled: false
    });
  });

  it("keeps valid sensitivity settings", () => {
    const settings = hydrateStorage({
      settings: {
        globalSensitivity: "high",
        notificationsEnabled: false
      }
    }).settings;

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      globalSensitivity: "high",
      notificationsEnabled: false
    });
  });

  it("falls back for invalid sensitivity settings", () => {
    const settings = hydrateStorage({
      settings: {
        globalSensitivity: "extreme"
      } as never
    }).settings;

    expect(settings.globalSensitivity).toBe(DEFAULT_SETTINGS.globalSensitivity);
  });

  it("keeps valid channel sensitivity", () => {
    const channels = hydrateStorage({
      channels: {
        test: {
          login: "test",
          broadcasterUserId: "1",
          displayName: "Test",
          profileImageUrl: "https://static-cdn.jtvnw.net/test.png",
          enabled: true,
          createClipsEnabled: false,
          sensitivity: "low"
        } as never
      }
    }).channels;

    expect(channels.test).toEqual({
      login: "test",
      broadcasterUserId: "1",
      displayName: "Test",
      profileImageUrl: "https://static-cdn.jtvnw.net/test.png",
      enabled: true,
      createClipsEnabled: false,
      sensitivity: "low",
      lastNotificationAt: undefined,
      status: undefined,
      errorCode: undefined,
      errorMessage: undefined
    });
  });

  it("drops invalid channel sensitivity", () => {
    const channels = hydrateStorage({
      channels: {
        test: {
          login: "test",
          broadcasterUserId: "1",
          enabled: true,
          sensitivity: "extreme"
        } as never
      }
    }).channels;

    expect("sensitivity" in channels.test).toBe(false);
  });

  it("defaults channel clip creation to explicit opt-in when missing from older storage", () => {
    const channels = hydrateStorage({
      channels: {
        test: {
          login: "test",
          broadcasterUserId: "1",
          enabled: true
        } as never
      }
    }).channels;

    expect(channels.test.createClipsEnabled).toBe(false);
  });
});
