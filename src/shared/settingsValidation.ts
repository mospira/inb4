import {
  DEFAULT_SETTINGS,
  SENSITIVITY_PRESETS
} from "./constants";
import type { SensitivityPresetName, Settings } from "./types";

export const MIN_COOLDOWN_SECONDS = 60;

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export function hydrateSettings(settings: Partial<Settings> = {}): Settings {
  return {
    defaultCooldownSeconds: isValidCooldownSeconds(settings.defaultCooldownSeconds)
      ? settings.defaultCooldownSeconds
      : DEFAULT_SETTINGS.defaultCooldownSeconds,
    notificationsEnabled:
      typeof settings.notificationsEnabled === "boolean"
        ? settings.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    createClipsEnabled:
      typeof settings.createClipsEnabled === "boolean"
        ? settings.createClipsEnabled
        : DEFAULT_SETTINGS.createClipsEnabled,
    globalSensitivity: isSensitivityPresetName(settings.globalSensitivity)
      ? settings.globalSensitivity
      : DEFAULT_SETTINGS.globalSensitivity
  };
}

export function validateSettingsPatch(
  patch: Partial<Settings>
): Partial<Settings> {
  const validated: Partial<Settings> = {};

  if (Object.prototype.hasOwnProperty.call(patch, "defaultCooldownSeconds")) {
    if (!isValidCooldownSeconds(patch.defaultCooldownSeconds)) {
      throw new SettingsValidationError(
        `Cooldown must be an integer of at least ${MIN_COOLDOWN_SECONDS} seconds.`
      );
    }

    validated.defaultCooldownSeconds = patch.defaultCooldownSeconds;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "notificationsEnabled")) {
    if (typeof patch.notificationsEnabled !== "boolean") {
      throw new SettingsValidationError("Notifications setting must be true or false.");
    }

    validated.notificationsEnabled = patch.notificationsEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "createClipsEnabled")) {
    if (typeof patch.createClipsEnabled !== "boolean") {
      throw new SettingsValidationError("Clip creation setting must be true or false.");
    }

    validated.createClipsEnabled = patch.createClipsEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "globalSensitivity")) {
    if (!isSensitivityPresetName(patch.globalSensitivity)) {
      throw new SettingsValidationError("Unknown sensitivity preset.");
    }

    validated.globalSensitivity = patch.globalSensitivity;
  }

  return validated;
}

export function isSensitivityPresetName(
  value: unknown
): value is SensitivityPresetName {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SENSITIVITY_PRESETS, value)
  );
}

function isValidCooldownSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_COOLDOWN_SECONDS
  );
}
