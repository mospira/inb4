import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_VALIDATE_ALARM } from "../shared/constants";
import type { StorageShape } from "../shared/types";

const apiMocks = vi.hoisted(() => ({
  createChatMessageSubscription: vi.fn(),
  createClip: vi.fn(),
  getRecentClips: vi.fn(),
  isStreamLive: vi.fn(),
  resolveTwitchUser: vi.fn(),
  validateToken: vi.fn()
}));

vi.mock("./twitchApi", () => {
  class TwitchApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string
    ) {
      super(message);
      this.name = "TwitchApiError";
    }
  }

  return {
    TwitchApiError,
    createChatMessageSubscription: apiMocks.createChatMessageSubscription,
    createClip: apiMocks.createClip,
    getRecentClips: apiMocks.getRecentClips,
    isStreamLive: apiMocks.isStreamLive,
    resolveTwitchUser: apiMocks.resolveTwitchUser,
    validateToken: apiMocks.validateToken
  };
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly close = vi.fn();
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

describe("background service worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    MockWebSocket.instances = [];

    apiMocks.createChatMessageSubscription.mockResolvedValue("subscription-id");
    apiMocks.getRecentClips.mockResolvedValue([]);
    apiMocks.isStreamLive.mockResolvedValue(true);
    apiMocks.resolveTwitchUser.mockResolvedValue(null);
    apiMocks.validateToken.mockResolvedValue({
      client_id: "1cad0usrogly9v4a1823p4gfcb16a3",
      login: "viewer",
      scopes: ["user:read:chat"],
      user_id: "viewer-id",
      expires_in: 3600
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates EventSub sockets without closing the old socket or resubscribing before replacement welcome", async () => {
    const storage = createStorage();
    const chromeStub = createChromeStub(storage);
    vi.stubGlobal("chrome", chromeStub);
    vi.stubGlobal("WebSocket", MockWebSocket);

    await import("./index");

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emitMessage(createWelcomeMessage("session-1"));

    await vi.waitFor(() => {
      expect(apiMocks.createChatMessageSubscription).toHaveBeenCalledTimes(1);
    });

    firstSocket.emitMessage(createReconnectMessage("wss://eventsub.example/reconnect"));

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
    });
    expect(firstSocket.close).not.toHaveBeenCalled();

    const replacementSocket = MockWebSocket.instances[1];
    replacementSocket.emitMessage(createWelcomeMessage("session-2"));

    await vi.waitFor(() => {
      expect(firstSocket.close).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.createChatMessageSubscription).toHaveBeenCalledTimes(1);
  });

  it("keeps auth on transient validation failures", async () => {
    const storage = createStorage();
    const chromeStub = createChromeStub(storage);
    vi.stubGlobal("chrome", chromeStub);
    vi.stubGlobal("WebSocket", MockWebSocket);
    apiMocks.validateToken.mockRejectedValue(new Error("network down"));

    await import("./index");

    await chromeStub.emitAlarm(AUTH_VALIDATE_ALARM);

    expect(storage.auth).not.toBeNull();
  });

  it("checks session storage for detector state before opening EventSub", async () => {
    const storage = createStorage();
    const chromeStub = createChromeStub(storage);
    vi.stubGlobal("chrome", chromeStub);
    vi.stubGlobal("WebSocket", MockWebSocket);

    await import("./index");

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    expect(chromeStub.storage.session.get).toHaveBeenCalledWith(
      "velocitySession"
    );
  });
});

function createStorage(): StorageShape {
  return {
    auth: {
      accessToken: "token",
      expiresAt: Date.now() + 60_000,
      userId: "viewer-id",
      login: "viewer",
      scopes: ["user:read:chat"],
      connectedAt: Date.now()
    },
    settings: {
      defaultCooldownSeconds: 600,
      notificationsEnabled: true,
      createClipsEnabled: false,
      globalSensitivity: "medium"
    },
    channels: {
      summit1g: {
        login: "summit1g",
        broadcasterUserId: "123",
        displayName: "summit1g",
        profileImageUrl: "https://static-cdn.jtvnw.net/summit1g.png",
        enabled: true,
        createClipsEnabled: false,
        status: "connecting"
      }
    }
  };
}

function createChromeStub(storage: StorageShape): {
  alarms: {
    create: ReturnType<typeof vi.fn>;
    onAlarm: { addListener: (listener: (alarm: { name: string }) => void) => void };
  };
  emitAlarm: (name: string) => Promise<void>;
  identity: { getRedirectURL: (path: string) => string };
  notifications: {
    clear: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    onClicked: { addListener: ReturnType<typeof vi.fn> };
    onClosed: { addListener: ReturnType<typeof vi.fn> };
  };
  runtime: {
    getURL: (path: string) => string;
    lastError: undefined;
    onInstalled: { addListener: ReturnType<typeof vi.fn> };
    onMessage: { addListener: ReturnType<typeof vi.fn> };
    onStartup: { addListener: ReturnType<typeof vi.fn> };
  };
  storage: {
    local: {
      clear: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    session: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
    onChanged: { addListener: ReturnType<typeof vi.fn> };
  };
  tabs: { create: ReturnType<typeof vi.fn> };
} {
  const alarmListeners: Array<(alarm: { name: string }) => void> = [];
  const localStorage: Record<string, unknown> = {
    auth: storage.auth,
    channels: storage.channels,
    settings: storage.settings
  };
  const sessionStorage: Record<string, unknown> = {};

  return {
    alarms: {
      create: vi.fn(),
      onAlarm: {
        addListener: (listener) => {
          alarmListeners.push(listener);
        }
      }
    },
    emitAlarm: async (name: string) => {
      for (const listener of alarmListeners) {
        listener({ name });
      }
      await Promise.resolve();
    },
    identity: {
      getRedirectURL: (path: string) => `https://example.chromiumapp.org/${path}`
    },
    notifications: {
      clear: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue("notification-id"),
      onClicked: { addListener: vi.fn() },
      onClosed: { addListener: vi.fn() }
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      lastError: undefined,
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() }
    },
    storage: {
      local: {
        clear: vi.fn(async () => {
          for (const key of Object.keys(localStorage)) {
            delete localStorage[key];
          }
          storage.auth = null;
          storage.channels = {};
        }),
        get: vi.fn(async (keys: string | string[]) => {
          const requestedKeys = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            requestedKeys.map((key) => [key, localStorage[key]])
          );
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(localStorage, values);
          if ("auth" in values) {
            storage.auth = values.auth as StorageShape["auth"];
          }
          if ("channels" in values) {
            storage.channels = values.channels as StorageShape["channels"];
          }
          if ("settings" in values) {
            storage.settings = values.settings as StorageShape["settings"];
          }
        })
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionStorage, values);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStorage[key];
        })
      },
      onChanged: { addListener: vi.fn() }
    },
    tabs: {
      create: vi.fn().mockResolvedValue({})
    }
  };
}

function createWelcomeMessage(sessionId: string): unknown {
  return {
    metadata: {
      message_id: `${sessionId}-welcome`,
      message_type: "session_welcome",
      message_timestamp: "2026-07-09T00:00:00Z"
    },
    payload: {
      session: {
        id: sessionId,
        status: "connected",
        connected_at: "2026-07-09T00:00:00Z",
        keepalive_timeout_seconds: 20
      }
    }
  };
}

function createReconnectMessage(reconnectUrl: string): unknown {
  return {
    metadata: {
      message_id: "reconnect-message",
      message_type: "session_reconnect",
      message_timestamp: "2026-07-09T00:00:01Z"
    },
    payload: {
      session: {
        id: "session-1",
        status: "reconnecting",
        connected_at: "2026-07-09T00:00:00Z",
        keepalive_timeout_seconds: 20,
        reconnect_url: reconnectUrl
      }
    }
  };
}
