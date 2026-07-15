import {
  AUTH_VALIDATE_ALARM,
  COLD_START_MS,
  CLIP_POLL_ALARM,
  CLIP_POLL_INTERVAL_MINUTES,
  CLIP_POLL_LOOKBACK_MS,
  EVENTSUB_RECOVER_ALARM,
  EVENTSUB_WEBSOCKET_URL,
  MAX_TRACKED_CHANNELS,
  PENDING_CHAT_CONFIRMATION_WINDOW_MS,
  SENSITIVITY_PRESETS,
  STORAGE_KEYS,
  TWITCH_CLIENT_ID,
  VELOCITY_CHECKPOINT_INTERVAL_MS,
  VELOCITY_SESSION_STORAGE_KEY
} from "../shared/constants";
import { assertValidLogin, normalizeLogin } from "../shared/login";
import {
  clearStorage,
  readStorage,
  writeAuth,
  writeChannels,
  writeSettings
} from "../shared/storage";
import type {
  ChannelConfig,
  ChannelErrorCode,
  ChannelRuntimeSummary,
  EventSubChatMessageNotification,
  EventSubReconnectPayload,
  EventSubRevocationPayload,
  EventSubWelcomePayload,
  EventSubMessage,
  EventSubRuntimeState,
  PublicAppState,
  RuntimeCommand,
  RuntimeResponse,
  SensitivityPresetName,
  Settings,
  StorageShape,
  StoredAuth
} from "../shared/types";
import { RuntimeCommandError, getRuntimeErrorCode, getRuntimeErrorMessage } from "../shared/runtimeError";
import { isSensitivityPresetName, SettingsValidationError, validateSettingsPatch } from "../shared/settingsValidation";
import { ClipSignalTracker } from "../shared/clipSignal";
import { resolveEventTimestamp } from "../shared/eventTimestamp";
import { VelocityEngine } from "../shared/velocity";
import {
  connectTwitch,
  getTwitchRedirectUri,
  hasClipEditScope,
  hasRequiredTwitchScopes
} from "./twitchAuth";
import { parseNotificationLogin } from "./notifications";
import { notifySpikeWithOptionalClip } from "./spikeNotification";
import { hasRequiredSpikeConfirmation } from "./spikeConfirmation";
import { waitForClipAvailability } from "./clipVerification";
import {
  requiresClipPermission,
  shouldCreateNotificationClip
} from "./clipSettings";
import {
  createNotificationClipLink,
  pruneNotificationClipLinks,
  readNotificationClipUrl,
  type NotificationClipLinkStore
} from "./notificationClipLinks";
import {
  getEventSubKeepaliveTimeoutSeconds,
  isEventSubLivenessExpired
} from "./eventSubLiveness";
import {
  createChatMessageSubscription,
  createClip,
  getRecentClips,
  isStreamLive,
  resolveTwitchUser,
  TwitchApiError,
  validateToken
} from "./twitchApi";
import type { CreatedClip } from "./twitchApi";
import { StartupNotificationWarmup } from "./startupWarmup";

const velocity = new VelocityEngine();
const clipSignals = new ClipSignalTracker();
const startupWarmup = new StartupNotificationWarmup(COLD_START_MS);
const NOTIFICATION_CLIP_DURATION_SECONDS = 60;
let socket: WebSocket | null = null;
let migrationSocket: WebSocket | null = null;
let storageCache: StorageShape | null = null;
let storageMutationQueue = Promise.resolve();
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let clipPollInFlight = false;
let lastEventSubMessageAt: number | undefined;
let eventSubKeepaliveTimeoutSeconds: number | undefined;
let velocityCheckpointTimer: ReturnType<typeof setTimeout> | undefined;
let eventSubState: EventSubRuntimeState = {
  socketState: "idle"
};
const subscriptionsByLogin = new Map<string, string>();
const pendingChatConfirmations = new Map<
  string,
  {
    detectedAt: number;
    currentMessagesPerMinute: number;
    spikeScore: number;
  }
>();
const notificationClipUrls = new Map<string, string>();
const notificationAttempts = new Set<string>();
const velocityInitialization = restoreVelocityState();

chrome.runtime.onInstalled.addListener(() => {
  scheduleRecurringAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  void velocityInitialization.then(() => {
    startFreshTrackingSession();
    scheduleRecurringAlarms();
    void refreshTrackedChannelProfiles();
    void ensureEventSub();
    void pollRecentClips();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void velocityInitialization.then(() => {
    if (alarm.name === AUTH_VALIDATE_ALARM) {
      void validateStoredAuth();
      return;
    }

    if (alarm.name === EVENTSUB_RECOVER_ALARM) {
      void ensureEventSub();
      return;
    }

    if (alarm.name === CLIP_POLL_ALARM) {
      void pollRecentClips();
    }
  });
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "local") {
    storageCache = null;
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeCommand, _sender, sendResponse) => {
  void velocityInitialization
    .then(() => handleCommand(message))
    .then((data) => {
      sendResponse({ ok: true, data } satisfies RuntimeResponse);
    })
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: getRuntimeErrorMessage(error),
        code: getRuntimeErrorCode(error)
      } satisfies RuntimeResponse);
    });

  return true;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  void handleNotificationClick(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId) => {
  void deleteNotificationClipUrl(notificationId);
});

void velocityInitialization.then(() => {
  scheduleRecurringAlarms();
  void refreshTrackedChannelProfiles();
  void ensureEventSub();
  void pollRecentClips();
});

function startFreshTrackingSession(): void {
  velocity.clear();
  markVelocityUnavailable();
  clipSignals.clear();
  pendingChatConfirmations.clear();
  startupWarmup.start();
}

async function restoreVelocityState(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(
      VELOCITY_SESSION_STORAGE_KEY
    );
    velocity.importState(stored[VELOCITY_SESSION_STORAGE_KEY]);
  } catch {
    // A missing or unavailable session checkpoint should fall back to cold start.
  } finally {
    velocity.markUnavailable();
  }
}

function scheduleVelocityCheckpoint(): void {
  if (velocityCheckpointTimer) {
    return;
  }

  velocityCheckpointTimer = setTimeout(() => {
    velocityCheckpointTimer = undefined;
    void persistVelocityState();
  }, VELOCITY_CHECKPOINT_INTERVAL_MS);
}

async function persistVelocityState(): Promise<void> {
  try {
    await chrome.storage.session.set({
      [VELOCITY_SESSION_STORAGE_KEY]: velocity.exportState()
    });
  } catch {
    // Detection remains functional in memory if checkpointing is unavailable.
  }
}

async function clearVelocityCheckpoint(): Promise<void> {
  clearTimeout(velocityCheckpointTimer);
  velocityCheckpointTimer = undefined;

  try {
    await chrome.storage.session.remove(VELOCITY_SESSION_STORAGE_KEY);
  } catch {
    // Local data clearing should continue even if session storage is unavailable.
  }
}

function markVelocityUnavailable(now = Date.now()): void {
  velocity.markUnavailable(now);
  scheduleVelocityCheckpoint();
}

function markVelocityAvailable(now = Date.now()): void {
  velocity.markAvailable(now);
  scheduleVelocityCheckpoint();
}

async function handleCommand(command: RuntimeCommand): Promise<PublicAppState> {
  switch (command.type) {
    case "GET_STATE":
      return getPublicState();

    case "CONNECT_TWITCH": {
      const stored = await loadStorage();
      const auth = await connectTwitch(requiresClipPermission(stored));
      return completeTwitchConnect(auth);
    }

    case "COMPLETE_TWITCH_CONNECT":
      return completeTwitchConnect(command.auth);

    case "DISCONNECT_TWITCH":
      closeEventSub("User disconnected Twitch.");
      eventSubState = { socketState: "auth_required" };
      await writeAuthAndCache(null);
      await markEnabledChannels("error", "auth_required", "Reconnect Twitch to track.");
      return getPublicState();

    case "ADD_CHANNEL":
      await addChannel(command.login);
      return getPublicState();

    case "REMOVE_CHANNEL":
      await removeChannel(command.login);
      return getPublicState();

    case "UPDATE_CHANNEL":
      await updateChannel(command.login, command.patch);
      return getPublicState();

    case "UPDATE_SETTINGS":
      await updateSettings(command.patch);
      return getPublicState();

    case "CLEAR_DATA":
      closeEventSub("Local data cleared.");
      velocity.clear();
      clipSignals.clear();
      pendingChatConfirmations.clear();
      subscriptionsByLogin.clear();
      notificationClipUrls.clear();
      notificationAttempts.clear();
      await clearVelocityCheckpoint();
      await clearStorageAndCache();
      eventSubState = { socketState: "idle" };
      return getPublicState();

    case "RECONNECT_EVENTSUB":
      await reconnectEventSub();
      return getPublicState();
  }
}

async function completeTwitchConnect(auth: StoredAuth): Promise<PublicAppState> {
  const stored = await loadStorage();
  if (requiresClipPermission(stored) && !hasClipEditScope(auth.scopes)) {
    throw new RuntimeCommandError(
      "Twitch did not grant clip permission. Disable clip creation for every channel or reconnect with clip permission.",
      "auth_required"
    );
  }

  await writeAuthAndCache(auth);
  await refreshTrackedChannelProfiles();
  await clearChannelErrors();
  await reconnectEventSub();
  return getPublicState();
}

async function getPublicState(): Promise<PublicAppState> {
  const stored = await loadStorage();
  const channels: ChannelRuntimeSummary[] = Object.values(stored.channels)
    .sort((a, b) => a.login.localeCompare(b.login))
    .map((channel) => {
      const sensitivity = effectiveSensitivity(channel);
      const snapshot = velocity.getSnapshot(channel.login, sensitivity);
      const clipSnapshot = clipSignals.getSnapshot(channel.login);

      return {
        ...channel,
        currentMessagesPerMinute: snapshot.currentMessagesPerMinute,
        baselineMessagesPerMinute: snapshot.baselineMessagesPerMinute,
        spikeScore: snapshot.spikeScore,
        baselineReady: snapshot.baselineReady,
        recentClipCount: clipSnapshot.recentClipCount,
        spikeActive: snapshot.spikeActive,
        subscriptionId: subscriptionsByLogin.get(channel.login)
      };
    });

  return {
    auth: stored.auth
      ? {
          expiresAt: stored.auth.expiresAt,
          userId: stored.auth.userId,
          login: stored.auth.login,
          scopes: stored.auth.scopes,
          connectedAt: stored.auth.connectedAt
        }
      : null,
    settings: stored.settings,
    channels,
    eventSub: eventSubState,
    redirectUri: getTwitchRedirectUri(),
    maxTrackedChannels: MAX_TRACKED_CHANNELS
  };
}

async function addChannel(input: string): Promise<void> {
  const login = assertValidLogin(input);
  const stored = await loadStorage();
  const auth = requireAuth(stored);

  const user = await resolveTwitchUser(login, auth);
  if (!user) {
    throw new RuntimeCommandError("Channel doesn't exist.", "not_found");
  }

  await mutateStorage((current) => {
    requireAuth(current);

    if (
      !current.channels[user.login] &&
      Object.keys(current.channels).length >= MAX_TRACKED_CHANNELS
    ) {
      throw new RuntimeCommandError(
        `The MVP supports up to ${MAX_TRACKED_CHANNELS} tracked channels.`,
        "validation"
      );
    }

    return {
      ...current,
      channels: {
        ...current.channels,
        [user.login]: {
          login: user.login,
          broadcasterUserId: user.id,
          displayName: user.display_name,
          profileImageUrl: user.profile_image_url,
          enabled: true,
          createClipsEnabled:
            current.channels[user.login]?.createClipsEnabled ??
            current.settings.createClipsEnabled,
          sensitivity:
            current.channels[user.login]?.sensitivity ??
            current.settings.globalSensitivity,
          lastNotificationAt: current.channels[user.login]?.lastNotificationAt,
          status: "connecting"
        } satisfies ChannelConfig
      }
    };
  });
  await subscribeAddedChannel(user.login);
}

async function removeChannel(input: string): Promise<void> {
  const login = normalizeLogin(input);
  velocity.clear(login);
  scheduleVelocityCheckpoint();
  clipSignals.clear(login);
  pendingChatConfirmations.delete(login);
  subscriptionsByLogin.delete(login);
  notificationAttempts.delete(login);
  await mutateStorage((stored) => {
    const channels = { ...stored.channels };
    delete channels[login];

    return {
      ...stored,
      channels
    };
  });
  await reconnectEventSub();
}

async function updateChannel(
  input: string,
  patch: Partial<Pick<ChannelConfig, "enabled" | "createClipsEnabled">> & {
    sensitivity?: SensitivityPresetName | null;
  }
): Promise<void> {
  const login = normalizeLogin(input);
  await mutateStorage((stored) => {
    const channel = stored.channels[login];

    if (!channel) {
      throw new RuntimeCommandError("Channel is no longer tracked.", "not_found");
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, "enabled") &&
      typeof patch.enabled !== "boolean"
    ) {
      throw new RuntimeCommandError("Tracking setting must be true or false.", "validation");
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, "createClipsEnabled") &&
      typeof patch.createClipsEnabled !== "boolean"
    ) {
      throw new RuntimeCommandError(
        "Clip creation setting must be true or false.",
        "validation"
      );
    }

    const updated: ChannelConfig = {
      ...channel,
      enabled: patch.enabled ?? channel.enabled,
      createClipsEnabled:
        patch.createClipsEnabled ?? channel.createClipsEnabled,
      status:
        patch.enabled === false
          ? "disabled"
          : patch.enabled === true
            ? "connecting"
            : channel.status
    };

    if (Object.prototype.hasOwnProperty.call(patch, "sensitivity")) {
      if (patch.sensitivity && isSensitivityPresetName(patch.sensitivity)) {
        updated.sensitivity = patch.sensitivity;
      } else if (patch.sensitivity) {
        throw new RuntimeCommandError("Unknown sensitivity preset.", "validation");
      } else {
        updated.sensitivity = stored.settings.globalSensitivity;
      }
    }

    return {
      ...stored,
      channels: {
        ...stored.channels,
        [login]: updated
      }
    };
  });

  if (patch.enabled === false) {
    pendingChatConfirmations.delete(login);
    clipSignals.clear(login);
    notificationAttempts.delete(login);
  }

  if (patch.enabled) {
    await subscribeAddedChannel(login);
  }
}

async function updateSettings(patch: Partial<Settings>): Promise<void> {
  try {
    const validatedPatch = validateSettingsPatch(patch);

    await mutateStorage((stored) => {
      if (
        validatedPatch.createClipsEnabled === true &&
        stored.auth &&
        !hasClipEditScope(stored.auth.scopes)
      ) {
        throw new RuntimeCommandError(
          "Reconnect Twitch with clip permission before enabling automatic clips.",
          "auth_required"
        );
      }

      return {
        ...stored,
        settings: {
          ...stored.settings,
          ...validatedPatch
        }
      };
    });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      throw new RuntimeCommandError(error.message, "validation");
    }

    throw error;
  }
}

async function refreshTrackedChannelProfiles(): Promise<void> {
  const stored = await loadStorage();

  if (!stored.auth) {
    return;
  }

  for (const channel of Object.values(stored.channels)) {
    if (channel.displayName && channel.profileImageUrl) {
      continue;
    }

    try {
      const user = await resolveTwitchUser(channel.login, stored.auth);

      if (!user) {
        continue;
      }

      await patchChannel(channel.login, {
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url
      });
    } catch (error) {
      if (error instanceof TwitchApiError && error.status === 401) {
        await handleAuthFailure("invalid-auth", "Reconnect Twitch to refresh channel profiles.");
      }
    }
  }
}

async function ensureEventSub(force = false): Promise<void> {
  const stored = await loadStorage();

  if (!stored.auth) {
    closeEventSub("Twitch authorization is required.");
    eventSubState = { socketState: "auth_required" };
    return;
  }

  const enabledChannels = Object.values(stored.channels).filter((channel) => channel.enabled);
  if (enabledChannels.length === 0) {
    closeEventSub("No enabled channels.");
    eventSubState = { socketState: "idle" };
    return;
  }

  if (Date.now() >= stored.auth.expiresAt) {
    await handleAuthFailure("expired-auth", "Twitch authorization expired.");
    return;
  }

  if (!force && socket && ["connecting", "connected"].includes(eventSubState.socketState)) {
    if (isCurrentEventSubSocketStale()) {
      closeEventSub("EventSub liveness timeout.");
    } else {
      return;
    }
  }

  if (!force && socket && eventSubState.socketState === "reconnecting") {
    if (migrationSocket && !isCurrentEventSubSocketStale()) {
      return;
    }

    closeEventSub("EventSub reconnect stalled.");
  }

  openEventSubSocket(EVENTSUB_WEBSOCKET_URL, stored.auth, "normal");
}

async function reconnectEventSub(): Promise<void> {
  closeEventSub("Reconnecting EventSub.");
  await ensureEventSub(true);
}

type EventSubOpenMode = "normal" | "migration";

function openEventSubSocket(
  url: string,
  auth: StoredAuth,
  mode: EventSubOpenMode
): void {
  if (mode === "normal") {
    closeEventSub("Opening EventSub socket.");
  } else if (migrationSocket) {
    migrationSocket.close(1000, "Replacing EventSub migration socket.");
  }

  eventSubState = {
    ...eventSubState,
    socketState:
      mode === "migration" || reconnectAttempt > 0 ? "reconnecting" : "connecting"
  };

  const nextSocket = new WebSocket(url);
  if (mode === "migration") {
    migrationSocket = nextSocket;
  } else {
    socket = nextSocket;
  }

  nextSocket.addEventListener("message", (event) => {
    void handleEventSubMessage(event.data, auth, nextSocket);
  });

  nextSocket.addEventListener("error", () => {
    if (socket === nextSocket || migrationSocket === nextSocket) {
      eventSubState = {
        ...eventSubState,
        socketState: "error",
        lastError: "EventSub WebSocket error."
      };
      if (socket === nextSocket) {
        markVelocityUnavailable();
      }
    }
  });

  nextSocket.addEventListener("close", () => {
    if (migrationSocket === nextSocket) {
      migrationSocket = null;
      eventSubState = {
        ...eventSubState,
        socketState: socket ? "reconnecting" : "error",
        lastError: "EventSub migration socket closed before welcome."
      };
      scheduleReconnect();
      return;
    }

    if (socket !== nextSocket) {
      return;
    }

    socket = null;
    markVelocityUnavailable();
    lastEventSubMessageAt = undefined;
    eventSubKeepaliveTimeoutSeconds = undefined;
    subscriptionsByLogin.clear();
    eventSubState = {
      ...eventSubState,
      socketState: "reconnecting",
      sessionId: undefined,
      lastMessageAt: undefined,
      keepaliveTimeoutSeconds: undefined,
      lastError: eventSubState.lastError ?? "EventSub WebSocket closed."
    };
    scheduleReconnect();
  });
}

async function handleEventSubMessage(
  data: unknown,
  auth: StoredAuth,
  activeSocket: WebSocket
): Promise<void> {
  if (socket !== activeSocket && migrationSocket !== activeSocket) {
    return;
  }

  const message = JSON.parse(String(data)) as EventSubMessage;
  markEventSubMessageReceived(message);

  switch (message.metadata.message_type) {
    case "session_welcome": {
      const welcome = message as EventSubWelcomePayload;
      reconnectAttempt = 0;
      const keepaliveTimeoutSeconds = getEventSubKeepaliveTimeoutSeconds(
        welcome.payload.session.keepalive_timeout_seconds
      );

      eventSubState = {
        socketState: "connected",
        sessionId: welcome.payload.session.id,
        connectedAt: Date.parse(welcome.payload.session.connected_at),
        lastKeepaliveAt: Date.now(),
        lastMessageAt: lastEventSubMessageAt,
        keepaliveTimeoutSeconds
      };

      eventSubKeepaliveTimeoutSeconds = keepaliveTimeoutSeconds;

      if (migrationSocket === activeSocket) {
        const oldSocket = socket;
        socket = activeSocket;
        migrationSocket = null;

        if (oldSocket) {
          oldSocket.close(1000, "EventSub migration complete.");
        }

        markVelocityAvailable();
        return;
      }

      await subscribeEnabledChannels(auth, welcome.payload.session.id);
      markVelocityAvailable();
      return;
    }

    case "session_keepalive":
      markVelocityAvailable();
      eventSubState = {
        ...eventSubState,
        lastKeepaliveAt: Date.now(),
        lastMessageAt: lastEventSubMessageAt
      };
      return;

    case "session_reconnect": {
      const reconnect = message as EventSubReconnectPayload;
      eventSubState = {
        ...eventSubState,
        socketState: "reconnecting",
        keepaliveTimeoutSeconds: getEventSubKeepaliveTimeoutSeconds(
          reconnect.payload.session.keepalive_timeout_seconds
        )
      };
      openEventSubSocket(reconnect.payload.session.reconnect_url, auth, "migration");
      return;
    }

    case "revocation": {
      const revocation = message as EventSubRevocationPayload;
      await handleRevocation(
        revocation.payload.subscription.condition.broadcaster_user_id
      );
      return;
    }

    case "notification":
      markVelocityAvailable();
      if (message.metadata.subscription_type === "channel.chat.message") {
        await handleChatNotification(message as EventSubChatMessageNotification);
      }
      return;
  }
}

async function subscribeEnabledChannels(auth: StoredAuth, sessionId: string): Promise<void> {
  const stored = await loadStorage();
  const channels = Object.values(stored.channels);

  await mutateChannels((currentChannels) =>
    Object.fromEntries(
      Object.entries(currentChannels).map(([login, channel]) => [
        login,
        {
          ...channel,
          status: channel.enabled ? "connecting" : "disabled",
          errorCode: undefined,
          errorMessage: undefined
        } satisfies ChannelConfig
      ])
    )
  );

  for (const channel of channels) {
    if (!channel.enabled) {
      continue;
    }

    await subscribeChannel(channel, auth, sessionId);
  }
}

async function subscribeAddedChannel(login: string): Promise<void> {
  const stored = await loadStorage();
  const channel = stored.channels[login];
  const sessionId = eventSubState.sessionId;

  if (
    channel?.enabled &&
    subscriptionsByLogin.has(login) &&
    socket &&
    ["connected", "reconnecting"].includes(eventSubState.socketState) &&
    !isCurrentEventSubSocketStale()
  ) {
    await patchChannel(login, {
      status: "subscribed",
      errorCode: undefined,
      errorMessage: undefined
    });
    return;
  }

  if (
    !channel?.enabled ||
    !stored.auth ||
    !socket ||
    eventSubState.socketState !== "connected" ||
    !sessionId ||
    isCurrentEventSubSocketStale()
  ) {
    await ensureEventSub();
    return;
  }

  await subscribeChannel(channel, stored.auth, sessionId);
}

async function subscribeChannel(
  channel: ChannelConfig,
  auth: StoredAuth,
  sessionId: string
): Promise<void> {
  try {
    const subscriptionId = await createChatMessageSubscription(
      channel,
      auth,
      sessionId
    );
    subscriptionsByLogin.set(channel.login, subscriptionId);
    await patchChannel(channel.login, {
      status: "subscribed",
      errorCode: undefined,
      errorMessage: undefined
    });
  } catch (error) {
    if (error instanceof TwitchApiError && error.status === 401) {
      await handleAuthFailure("invalid-auth", "Reconnect Twitch to resume tracking.");
    }

    await patchChannel(channel.login, subscriptionFailurePatch(error));
  }
}

async function handleChatNotification(
  message: EventSubChatMessageNotification
): Promise<void> {
  const login = normalizeLogin(message.payload.event.broadcaster_user_login);
  const stored = await loadStorage();
  const channel =
    stored.channels[login] ??
    Object.values(stored.channels).find(
      (candidate) =>
        candidate.broadcasterUserId === message.payload.event.broadcaster_user_id
    );

  if (!channel?.enabled) {
    return;
  }

  const now = Date.now();
  const eventTimestamp = resolveEventTimestamp(
    message.metadata.message_timestamp,
    now
  );
  if (eventTimestamp === null) {
    return;
  }
  const recorded = velocity.recordMessage(
    channel.login,
    message.payload.event.message_id || message.metadata.message_id,
    eventTimestamp,
    message.payload.event.chatter_user_id,
    now
  );

  if (!recorded) {
    return;
  }

  scheduleVelocityCheckpoint();

  await maybeNotifyForChannel(channel, stored, now);
}

async function pollRecentClips(): Promise<void> {
  if (clipPollInFlight) {
    return;
  }

  clipPollInFlight = true;

  try {
    const stored = await loadStorage();
    const auth = stored.auth;

    if (!auth) {
      return;
    }

    if (Date.now() >= auth.expiresAt) {
      await handleAuthFailure("expired-auth", "Twitch authorization expired.");
      return;
    }

    const channels = Object.values(stored.channels).filter(
      (channel) => channel.enabled
    );
    if (channels.length === 0) {
      return;
    }

    const now = Date.now();
    const startedAt = new Date(now - CLIP_POLL_LOOKBACK_MS);
    const endedAt = new Date(now);

    for (const channel of channels) {
      try {
        const recentClips = await getRecentClips(
          channel.broadcasterUserId,
          auth,
          startedAt,
          endedAt
        );
        clipSignals.recordClips(
          channel.login,
          recentClips.map((clip) => ({
            id: clip.id,
            createdAt: Date.parse(clip.created_at)
          })),
          now
        );
        await maybeNotifyForChannel(channel, stored, now);
      } catch (error) {
        if (error instanceof TwitchApiError && error.status === 401) {
          await handleAuthFailure("invalid-auth", "Reconnect Twitch to resume clip polling.");
        }
      }
    }

    prunePendingChatConfirmations(now);
  } finally {
    clipPollInFlight = false;
  }
}

async function maybeNotifyForChannel(
  channel: ChannelConfig,
  stored: StorageShape,
  now: number
): Promise<void> {
  const sensitivity = effectiveSensitivity(channel);
  const preset = SENSITIVITY_PRESETS[sensitivity];
  const trigger = velocity.evaluate(
    channel.login,
    sensitivity,
    channel.lastNotificationAt ?? 0,
    now,
    stored.settings.defaultCooldownSeconds,
    { commitSpike: false }
  );
  rememberPendingChatConfirmation(
    channel.login,
    trigger,
    now,
    preset.clipConfirmedChatScore
  );

  const clipSnapshot = clipSignals.getSnapshot(channel.login, now);
  const pending = getPendingChatConfirmation(channel.login, now);
  const clipConfirmed = hasRequiredSpikeConfirmation({
    baselineReady: trigger.baselineReady,
    startupWarmupActive: startupWarmup.isActive(now),
    notificationsEnabled: stored.settings.notificationsEnabled,
    hasPendingChatConfirmation: Boolean(pending),
    recentClipCount: clipSnapshot.recentClipCount,
    spikeActive: trigger.spikeActive,
    notificationCooldownElapsed: notificationCooldownElapsed(
      channel,
      stored.settings,
      now
    )
  });

  if (!clipConfirmed) {
    return;
  }

  if (notificationAttempts.has(channel.login)) {
    return;
  }

  notificationAttempts.add(channel.login);

  try {
    const auth = stored.auth;
    if (!auth) {
      await handleAuthFailure("invalid-auth", "Reconnect Twitch to send notifications.");
      return;
    }

    const liveStatus = await getLiveNotificationStatus(channel, auth);
    if (liveStatus === "offline") {
      pendingChatConfirmations.delete(channel.login);
      return;
    }

    if (liveStatus !== "live") {
      return;
    }

    const notification = await notifySpikeWithOptionalClip({
      login: channel.login,
      createClip: shouldCreateNotificationClip(channel, auth)
        ? () => createClipForNotification(channel, auth)
        : undefined
    });

    velocity.activateSpike(channel.login, now);
    scheduleVelocityCheckpoint();

    if (notification.clipUrl) {
      await saveNotificationClipUrl(notification.notificationId, notification.clipUrl);
    }

    pendingChatConfirmations.delete(channel.login);
    await patchChannel(channel.login, {
      lastNotificationAt: Date.now()
    });
  } catch {
    eventSubState = {
      ...eventSubState,
      lastError: "Chrome could not create the notification."
    };
  } finally {
    notificationAttempts.delete(channel.login);
  }
}

async function createClipForNotification(
  channel: ChannelConfig,
  auth: StoredAuth
): Promise<CreatedClip | null> {
  try {
    const clip = await createClip(
      channel.broadcasterUserId,
      auth,
      NOTIFICATION_CLIP_DURATION_SECONDS
    );
    const verifiedClip = await waitForClipAvailability(clip.id, auth);

    return verifiedClip ? clip : null;
  } catch (error) {
    if (error instanceof TwitchApiError && error.status === 401) {
      await handleAuthFailure("invalid-auth", "Reconnect Twitch to resume clip creation.");
    }

    return null;
  }
}

type LiveNotificationStatus = "live" | "offline" | "auth_error" | "transient_error";

async function getLiveNotificationStatus(
  channel: ChannelConfig,
  auth: StoredAuth
): Promise<LiveNotificationStatus> {
  try {
    return (await isStreamLive(channel.broadcasterUserId, auth)) ? "live" : "offline";
  } catch (error) {
    if (error instanceof TwitchApiError && error.status === 401) {
      await handleAuthFailure("invalid-auth", "Reconnect Twitch to resume live-status checks.");
      return "auth_error";
    }

    return "transient_error";
  }
}

function rememberPendingChatConfirmation(
  channelLogin: string,
  trigger: {
    baselineReady: boolean;
    currentMessagesPerMinute: number;
    spikeActive: boolean;
    spikeScore: number;
  },
  now: number,
  clipConfirmedChatScore: number
): void {
  if (
    trigger.baselineReady &&
    !trigger.spikeActive &&
    trigger.spikeScore >= clipConfirmedChatScore
  ) {
    pendingChatConfirmations.set(channelLogin, {
      detectedAt: now,
      currentMessagesPerMinute: trigger.currentMessagesPerMinute,
      spikeScore: trigger.spikeScore
    });
  }
}

function getPendingChatConfirmation(
  channelLogin: string,
  now: number
):
  | {
      detectedAt: number;
      currentMessagesPerMinute: number;
      spikeScore: number;
    }
  | undefined {
  const pending = pendingChatConfirmations.get(channelLogin);
  if (!pending) {
    return undefined;
  }

  if (now - pending.detectedAt > PENDING_CHAT_CONFIRMATION_WINDOW_MS) {
    pendingChatConfirmations.delete(channelLogin);
    return undefined;
  }

  return pending;
}

function prunePendingChatConfirmations(now: number): void {
  for (const [login, pending] of pendingChatConfirmations) {
    if (now - pending.detectedAt > PENDING_CHAT_CONFIRMATION_WINDOW_MS) {
      pendingChatConfirmations.delete(login);
    }
  }
}

function markEventSubMessageReceived(message: EventSubMessage): void {
  lastEventSubMessageAt = Date.now();
  eventSubState = {
    ...eventSubState,
    lastMessageAt: lastEventSubMessageAt
  };

  if (message.metadata.message_type === "session_welcome") {
    const welcome = message as EventSubWelcomePayload;
    eventSubKeepaliveTimeoutSeconds = getEventSubKeepaliveTimeoutSeconds(
      welcome.payload.session.keepalive_timeout_seconds
    );
    return;
  }

  if (message.metadata.message_type === "session_reconnect") {
    const reconnect = message as EventSubReconnectPayload;
    eventSubKeepaliveTimeoutSeconds = getEventSubKeepaliveTimeoutSeconds(
      reconnect.payload.session.keepalive_timeout_seconds
    );
  }
}

function isCurrentEventSubSocketStale(): boolean {
  return isEventSubLivenessExpired({
    lastMessageAt: lastEventSubMessageAt,
    keepaliveTimeoutSeconds: eventSubKeepaliveTimeoutSeconds
  });
}

async function handleNotificationClick(notificationId: string): Promise<void> {
  const clipUrl = await getNotificationClipUrl(notificationId);

  if (clipUrl) {
    await chrome.tabs.create({ url: clipUrl });
    await deleteNotificationClipUrl(notificationId);
    await chrome.notifications.clear(notificationId);
    return;
  }

  const login = parseNotificationLogin(notificationId);

  if (login) {
    await chrome.tabs.create({ url: `https://www.twitch.tv/${login}` });
    await chrome.notifications.clear(notificationId);
  }
}

async function getNotificationClipUrl(
  notificationId: string
): Promise<string | null> {
  const links = await loadNotificationClipUrls();
  return readNotificationClipUrl(links, notificationId);
}

async function saveNotificationClipUrl(
  notificationId: string,
  clipUrl: string
): Promise<void> {
  const links = await loadNotificationClipUrls();
  links[notificationId] = createNotificationClipLink(clipUrl);
  await writeNotificationClipUrls(links);
}

async function deleteNotificationClipUrl(notificationId: string): Promise<void> {
  const links = await loadNotificationClipUrls();
  delete links[notificationId];
  await writeNotificationClipUrls(links);
}

async function loadNotificationClipUrls(): Promise<NotificationClipLinkStore> {
  const raw = await chrome.storage.local.get(STORAGE_KEYS.notificationClipUrls);
  const store = coerceNotificationClipLinkStore(
    raw[STORAGE_KEYS.notificationClipUrls]
  );
  const pruned = pruneNotificationClipLinks(store);

  notificationClipUrls.clear();
  for (const [notificationId, link] of Object.entries(pruned)) {
    notificationClipUrls.set(notificationId, link.url);
  }

  if (Object.keys(pruned).length !== Object.keys(store).length) {
    await writeNotificationClipUrls(pruned);
  }

  return pruned;
}

async function writeNotificationClipUrls(
  links: NotificationClipLinkStore
): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.notificationClipUrls]: links
  });

  notificationClipUrls.clear();
  for (const [notificationId, link] of Object.entries(links)) {
    notificationClipUrls.set(notificationId, link.url);
  }
}

function coerceNotificationClipLinkStore(
  value: unknown
): NotificationClipLinkStore {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as NotificationClipLinkStore).filter(([, link]) => {
      return (
        link &&
        typeof link.url === "string" &&
        typeof link.expiresAt === "number" &&
        Number.isFinite(link.expiresAt)
      );
    })
  );
}

function effectiveSensitivity(
  channel: ChannelConfig
): SensitivityPresetName {
  if (isSensitivityPresetName(channel.sensitivity)) {
    return channel.sensitivity;
  }

  return "medium";
}

function notificationCooldownElapsed(
  channel: ChannelConfig,
  settings: Settings,
  now: number
): boolean {
  return (
    !channel.lastNotificationAt ||
    now - channel.lastNotificationAt >=
      settings.defaultCooldownSeconds * 1000
  );
}

async function handleRevocation(broadcasterUserId: string | undefined): Promise<void> {
  if (!broadcasterUserId) {
    return;
  }

  const stored = await loadStorage();
  const channel = Object.values(stored.channels).find(
    (candidate) => candidate.broadcasterUserId === broadcasterUserId
  );

  if (!channel) {
    return;
  }

  subscriptionsByLogin.delete(channel.login);
  await patchChannel(channel.login, {
    status: "error",
    errorCode: "temporary_failure",
    errorMessage: "Twitch revoked this channel subscription."
  });
}

function scheduleReconnect(): void {
  clearTimeout(reconnectTimer);
  reconnectAttempt += 1;
  const delayMs = Math.min(60_000, 1000 * 2 ** Math.min(reconnectAttempt, 6));
  reconnectTimer = setTimeout(() => {
    void ensureEventSub(true);
  }, delayMs);
}

function closeEventSub(reason: string): void {
  clearTimeout(reconnectTimer);
  markVelocityUnavailable();

  if (socket) {
    const closingSocket = socket;
    socket = null;
    closingSocket.close(1000, reason);
  }

  if (migrationSocket) {
    const closingSocket = migrationSocket;
    migrationSocket = null;
    closingSocket.close(1000, reason);
  }

  lastEventSubMessageAt = undefined;
  eventSubKeepaliveTimeoutSeconds = undefined;
  subscriptionsByLogin.clear();
}

async function validateStoredAuth(): Promise<void> {
  const stored = await loadStorage();

  if (!stored.auth) {
    return;
  }

  try {
    const validation = await validateToken(stored.auth.accessToken);

    if (
      validation.client_id !== TWITCH_CLIENT_ID ||
      !hasRequiredTwitchScopes(validation.scopes)
    ) {
      await handleAuthFailure("missing-scopes", "Reconnect Twitch to grant chat access.");
      return;
    }

    await writeAuthAndCache({
      ...stored.auth,
      expiresAt: Date.now() + validation.expires_in * 1000,
      userId: validation.user_id,
      login: validation.login,
      scopes: validation.scopes
    });
  } catch (error) {
    if (error instanceof TwitchApiError && error.status === 401) {
      await handleAuthFailure("invalid-auth", "Reconnect Twitch to resume tracking.");
      return;
    }

    eventSubState = {
      ...eventSubState,
      lastError: "Twitch auth validation temporarily failed."
    };
  }
}

type AuthFailureKind =
  | "expired-auth"
  | "invalid-auth"
  | "missing-scopes"
  | "transient";

async function handleAuthFailure(
  kind: AuthFailureKind,
  message: string
): Promise<void> {
  if (kind === "transient") {
    eventSubState = {
      ...eventSubState,
      lastError: message
    };
    return;
  }

  closeEventSub(message);
  await writeAuthAndCache(null);
  await markEnabledChannels("error", "auth_required", "Reconnect Twitch to track.");
  eventSubState = {
    socketState: "auth_required",
    lastError: message
  };
}

function scheduleRecurringAlarms(): void {
  chrome.alarms.create(AUTH_VALIDATE_ALARM, {
    periodInMinutes: 60
  });
  chrome.alarms.create(EVENTSUB_RECOVER_ALARM, {
    periodInMinutes: 0.5
  });
  chrome.alarms.create(CLIP_POLL_ALARM, {
    periodInMinutes: CLIP_POLL_INTERVAL_MINUTES
  });
}

function requireAuth(stored: StorageShape): StoredAuth {
  if (!stored.auth) {
    throw new RuntimeCommandError("Connect Twitch before adding channels.", "auth_required");
  }

  return stored.auth;
}

async function loadStorage(force = false): Promise<StorageShape> {
  await storageMutationQueue;

  if (!storageCache || force) {
    storageCache = await readStorage();
  }

  return storageCache;
}

async function mutateStorage(
  mutator: (stored: StorageShape) => StorageShape | Promise<StorageShape>
): Promise<StorageShape> {
  const mutation = storageMutationQueue.then(async () => {
    const stored = await readStorage();
    const next = await mutator(stored);

    await writeAuth(next.auth);
    await writeSettings(next.settings);
    await writeChannels(next.channels);
    storageCache = next;

    return next;
  });

  storageMutationQueue = mutation.then(
    () => undefined,
    () => undefined
  );

  return mutation;
}

async function clearStorageAndCache(): Promise<void> {
  const mutation = storageMutationQueue.then(async () => {
    await clearStorage();
    storageCache = null;
  });

  storageMutationQueue = mutation.then(
    () => undefined,
    () => undefined
  );

  await mutation;
}

async function writeAuthAndCache(auth: StoredAuth | null): Promise<void> {
  await mutateStorage((stored) => ({
    ...stored,
    auth
  }));
}

async function mutateChannels(
  mutator: (
    channels: Record<string, ChannelConfig>,
    stored: StorageShape
  ) => Record<string, ChannelConfig>
): Promise<void> {
  await mutateStorage((stored) => ({
    ...stored,
    channels: mutator(stored.channels, stored)
  }));
}

async function patchChannel(
  login: string,
  patch: Partial<ChannelConfig>
): Promise<void> {
  await mutateChannels((channels) => {
    const channel = channels[login];

    if (!channel) {
      return channels;
    }

    return {
      ...channels,
      [login]: {
        ...channel,
        ...patch
      }
    };
  });
}

async function clearChannelErrors(): Promise<void> {
  await mutateChannels((channels) =>
    Object.fromEntries(
      Object.entries(channels).map(([login, channel]) => [
      login,
      {
        ...channel,
        status: channel.enabled ? "connecting" : "disabled",
        errorCode: undefined,
        errorMessage: undefined
      } satisfies ChannelConfig
      ])
    )
  );
}

async function markEnabledChannels(
  status: ChannelConfig["status"],
  errorCode?: ChannelErrorCode,
  errorMessage?: string
): Promise<void> {
  await mutateChannels((channels) =>
    Object.fromEntries(
      Object.entries(channels).map(([login, channel]) => [
        login,
        channel.enabled
          ? {
              ...channel,
              status,
              errorCode,
              errorMessage
            }
          : channel
      ])
    )
  );
}

function subscriptionFailurePatch(error: unknown): Partial<ChannelConfig> {
  if (error instanceof TwitchApiError) {
    if (error.status === 401) {
      eventSubState = {
        ...eventSubState,
        socketState: "auth_required",
        lastError: "Reconnect Twitch to resume tracking."
      };

      return {
        status: "error",
        errorCode: "auth_required",
        errorMessage: "Reconnect Twitch to resume tracking."
      };
    }

    if (error.status === 403) {
      return {
        status: "error",
        errorCode: "auth_missing_scope",
        errorMessage: "Twitch token is missing chat access."
      };
    }

    if (error.status === 429) {
      return {
        status: "error",
        errorCode: "subscription_limit",
        errorMessage: "Twitch subscription limit was reached."
      };
    }
  }

  return {
    status: "error",
    errorCode: "temporary_failure",
    errorMessage: "Twitch could not create this subscription."
  };
}
