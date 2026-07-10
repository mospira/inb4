export const TWITCH_CLIENT_ID = "1cad0usrogly9v4a1823p4gfcb16a3";
export const TWITCH_CHAT_READ_SCOPE = "user:read:chat";
export const TWITCH_CLIPS_EDIT_SCOPE = "clips:edit";
export const TWITCH_AUTH_SCOPES = [
  TWITCH_CHAT_READ_SCOPE
] as const;
export const TWITCH_AUTH_SCOPE = TWITCH_AUTH_SCOPES.join(" ");
export const TWITCH_CLIP_AUTH_SCOPE = [
  TWITCH_CHAT_READ_SCOPE,
  TWITCH_CLIPS_EDIT_SCOPE
].join(" ");
export const MAX_TRACKED_CHANNELS = 10;
export const EVENTSUB_WEBSOCKET_URL =
  "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=20";
export const DEFAULT_EVENTSUB_KEEPALIVE_TIMEOUT_SECONDS = 20;
export const EVENTSUB_LIVENESS_GRACE_MS = 5_000;

export const AUTH_VALIDATE_ALARM = "inb4-auth-validate";
export const EVENTSUB_RECOVER_ALARM = "inb4-eventsub-recover";
export const CLIP_POLL_ALARM = "inb4-clip-poll";

export const STORAGE_KEYS = {
  auth: "auth",
  channels: "channels",
  settings: "settings",
  notificationClipUrls: "notificationClipUrls"
} as const;

export const SENSITIVITY_PRESETS = {
  high: {
    label: "High",
    strongChatScore: 2.5,
    clipConfirmedChatScore: 1.75,
    recoveryScore: 1.25
  },
  medium: {
    label: "Medium",
    strongChatScore: 3,
    clipConfirmedChatScore: 2,
    recoveryScore: 1.5
  },
  low: {
    label: "Low",
    strongChatScore: 3.75,
    clipConfirmedChatScore: 2.75,
    recoveryScore: 2
  }
} as const;

export type SensitivityPresetName = keyof typeof SENSITIVITY_PRESETS;
export type SensitivityPreset =
  (typeof SENSITIVITY_PRESETS)[SensitivityPresetName];

export const DEFAULT_SETTINGS = {
  defaultCooldownSeconds: 600,
  notificationsEnabled: true,
  createClipsEnabled: false,
  globalSensitivity: "medium"
} as const;

export const VELOCITY_WINDOW_MS = 30_000;
export const BASELINE_SAMPLE_INTERVAL_MS = 5_000;
export const BASELINE_EMA_ALPHA = 0.05;
export const COLD_START_MS = 180_000;
export const EMERGENCY_WINDOW_MS = 30_000;
export const EMERGENCY_MESSAGES_PER_MINUTE = 100;
export const CLIP_CONFIRMATION_MIN_COUNT = 2;
export const CLIP_CONFIRMATION_WINDOW_MS = 60_000;
export const PENDING_CHAT_CONFIRMATION_WINDOW_MS = 120_000;
export const CLIP_POLL_LOOKBACK_MS = 5 * 60_000;
export const CLIP_POLL_INTERVAL_MINUTES = 0.5;
export const CLIP_EVENT_RETENTION_MS = 60 * 60_000;
export const CLIP_NOTIFICATION_DELAY_MS = 10_000;
export const CLIP_VERIFICATION_TIMEOUT_MS = 60_000;
export const CLIP_VERIFICATION_POLL_INTERVAL_MS = 2_000;
export const MAX_TIMESTAMP_AGE_MS = 15 * 60_000;
export const MAX_DUPLICATE_IDS = 500;
