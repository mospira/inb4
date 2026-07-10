import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS
} from "./constants";
import type {
  ChannelConfig,
  Settings,
  StorageShape,
  StoredAuth
} from "./types";
import { hydrateSettings, isSensitivityPresetName } from "./settingsValidation";

type RawStorage = Partial<{
  auth: StoredAuth | null;
  channels: Record<string, ChannelConfig>;
  settings: Partial<Settings>;
}>;

export function hydrateStorage(raw: RawStorage): StorageShape {
  return {
    auth: raw.auth ?? null,
    settings: hydrateSettings(raw.settings),
    channels: hydrateChannels(raw.channels ?? {})
  };
}

function hydrateChannels(
  channels: Record<string, ChannelConfig>
): Record<string, ChannelConfig> {
  return Object.fromEntries(
    Object.entries(channels).map(([login, channel]) => [
      login,
      ({
        login: channel.login,
        broadcasterUserId: channel.broadcasterUserId,
        displayName: channel.displayName,
        profileImageUrl: channel.profileImageUrl,
        enabled: channel.enabled,
        createClipsEnabled:
          typeof channel.createClipsEnabled === "boolean"
            ? channel.createClipsEnabled
            : DEFAULT_SETTINGS.createClipsEnabled,
        lastNotificationAt: channel.lastNotificationAt,
        status: channel.status,
        errorCode: channel.errorCode,
        errorMessage: channel.errorMessage,
        ...(isSensitivityPresetName(channel.sensitivity)
          ? { sensitivity: channel.sensitivity }
          : {})
      }) satisfies ChannelConfig
    ])
  );
}

export async function readStorage(): Promise<StorageShape> {
  const raw = await chrome.storage.local.get([
    STORAGE_KEYS.auth,
    STORAGE_KEYS.channels,
    STORAGE_KEYS.settings
  ]);

  return hydrateStorage(raw as RawStorage);
}

export async function writeAuth(auth: StoredAuth | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.auth]: auth });
}

export async function writeChannels(
  channels: Record<string, ChannelConfig>
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.channels]: channels });
}

export async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function clearStorage(): Promise<void> {
  await chrome.storage.local.clear();
}
