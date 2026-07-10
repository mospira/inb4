import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import {
  hydrateSettings,
  SettingsValidationError,
  validateSettingsPatch
} from "./settingsValidation";

describe("settingsValidation", () => {
  it("hydrates invalid settings back to safe defaults", () => {
    expect(
      hydrateSettings({
        defaultCooldownSeconds: -1,
        notificationsEnabled: "yes",
        createClipsEnabled: "yes",
        globalSensitivity: "extreme"
      } as never)
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts valid runtime settings patches", () => {
    expect(
      validateSettingsPatch({
        defaultCooldownSeconds: 120,
        notificationsEnabled: false,
        createClipsEnabled: true,
        globalSensitivity: "high"
      })
    ).toEqual({
      defaultCooldownSeconds: 120,
      notificationsEnabled: false,
      createClipsEnabled: true,
      globalSensitivity: "high"
    });
  });

  it("rejects cooldowns below the MVP minimum", () => {
    expect(() =>
      validateSettingsPatch({
        defaultCooldownSeconds: -30
      })
    ).toThrow(SettingsValidationError);
  });

  it("rejects unknown sensitivity presets", () => {
    expect(() =>
      validateSettingsPatch({
        globalSensitivity: "extreme"
      } as never)
    ).toThrow(SettingsValidationError);
  });
});
