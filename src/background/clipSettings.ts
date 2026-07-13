import type { ChannelConfig, StorageShape, StoredAuth } from "../shared/types";
import { hasClipEditScope } from "./twitchAuth";

export function shouldCreateNotificationClip(
  channel: ChannelConfig,
  auth: StoredAuth
): boolean {
  return channel.createClipsEnabled && hasClipEditScope(auth.scopes);
}

export function requiresClipPermission(stored: StorageShape): boolean {
  return (
    stored.settings.createClipsEnabled ||
    Object.values(stored.channels).some((channel) => channel.createClipsEnabled)
  );
}
