import type { SensitivityPresetName } from "./constants";

export type { SensitivityPreset, SensitivityPresetName } from "./constants";

export interface StoredAuth {
  accessToken: string;
  expiresAt: number;
  userId: string;
  login: string;
  scopes: string[];
  connectedAt: number;
}

export interface Settings {
  defaultCooldownSeconds: number;
  notificationsEnabled: boolean;
  createClipsEnabled: boolean;
  globalSensitivity: SensitivityPresetName;
}

export type ChannelStatus =
  | "active"
  | "connecting"
  | "disabled"
  | "error"
  | "subscribed";

export type ChannelErrorCode =
  | "invalid_channel"
  | "auth_missing_scope"
  | "subscription_limit"
  | "temporary_failure"
  | "auth_required";

export interface ChannelConfig {
  login: string;
  broadcasterUserId: string;
  displayName?: string;
  profileImageUrl?: string;
  enabled: boolean;
  createClipsEnabled: boolean;
  sensitivity: SensitivityPresetName;
  lastNotificationAt?: number;
  status?: ChannelStatus;
  errorCode?: ChannelErrorCode;
  errorMessage?: string;
}

export interface StorageShape {
  auth: StoredAuth | null;
  settings: Settings;
  channels: Record<string, ChannelConfig>;
}

export type EventSubSocketState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "auth_required"
  | "error";

export interface EventSubRuntimeState {
  socketState: EventSubSocketState;
  sessionId?: string;
  connectedAt?: number;
  lastKeepaliveAt?: number;
  lastMessageAt?: number;
  keepaliveTimeoutSeconds?: number;
  lastError?: string;
}

export interface ChannelRuntimeSummary extends ChannelConfig {
  currentMessagesPerMinute: number;
  baselineMessagesPerMinute: number;
  spikeScore: number;
  baselineReady: boolean;
  recentClipCount: number;
  spikeActive: boolean;
  subscriptionId?: string;
}

export interface PublicAppState {
  auth: Omit<StoredAuth, "accessToken"> | null;
  settings: Settings;
  channels: ChannelRuntimeSummary[];
  eventSub: EventSubRuntimeState;
  redirectUri: string;
  maxTrackedChannels: number;
}

export type RuntimeCommand =
  | { type: "GET_STATE" }
  | { type: "CONNECT_TWITCH" }
  | { type: "COMPLETE_TWITCH_CONNECT"; auth: StoredAuth }
  | { type: "DISCONNECT_TWITCH" }
  | { type: "ADD_CHANNEL"; login: string }
  | { type: "REMOVE_CHANNEL"; login: string }
  | {
      type: "UPDATE_CHANNEL";
      login: string;
      patch: Partial<Pick<ChannelConfig, "enabled" | "createClipsEnabled">> & {
        sensitivity?: SensitivityPresetName | null;
      };
    }
  | { type: "UPDATE_SETTINGS"; patch: Partial<Settings> }
  | { type: "CLEAR_DATA" }
  | { type: "RECONNECT_EVENTSUB" };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: RuntimeErrorCode };

export type RuntimeErrorCode =
  | "auth_required"
  | "not_found"
  | "transient"
  | "validation"
  | "unknown";

export interface TwitchValidationResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
}

export interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
  is_featured: boolean;
}

export interface EventSubWelcomePayload {
  metadata: {
    message_id: string;
    message_type: "session_welcome";
    message_timestamp: string;
  };
  payload: {
    session: {
      id: string;
      status: string;
      connected_at: string;
      keepalive_timeout_seconds?: number;
      reconnect_url?: string | null;
    };
  };
}

export interface EventSubKeepalivePayload {
  metadata: {
    message_id: string;
    message_type: "session_keepalive";
    message_timestamp: string;
  };
  payload: Record<string, never>;
}

export interface EventSubReconnectPayload {
  metadata: {
    message_id: string;
    message_type: "session_reconnect";
    message_timestamp: string;
  };
  payload: {
    session: {
      id: string;
      status: string;
      connected_at: string;
      keepalive_timeout_seconds?: number;
      reconnect_url: string;
    };
  };
}

export interface EventSubRevocationPayload {
  metadata: {
    message_id: string;
    message_type: "revocation";
    subscription_type?: string;
    subscription_version?: string;
    message_timestamp: string;
  };
  payload: {
    subscription: {
      id: string;
      status: string;
      type: string;
      version: string;
      condition: {
        broadcaster_user_id?: string;
        user_id?: string;
      };
    };
  };
}

export interface EventSubChatMessageNotification {
  metadata: {
    message_id: string;
    message_type: "notification";
    subscription_type: "channel.chat.message";
    subscription_version: "1";
    message_timestamp: string;
  };
  payload: {
    subscription: {
      id: string;
      type: "channel.chat.message";
      version: "1";
      condition: {
        broadcaster_user_id: string;
        user_id: string;
      };
    };
    event: {
      broadcaster_user_id: string;
      broadcaster_user_login: string;
      chatter_user_id: string;
      chatter_user_login: string;
      message_id: string;
      message: {
        text?: string;
      };
    };
  };
}

export type EventSubMessage =
  | EventSubWelcomePayload
  | EventSubKeepalivePayload
  | EventSubReconnectPayload
  | EventSubRevocationPayload
  | EventSubChatMessageNotification;
