import { TWITCH_CLIENT_ID } from "../shared/constants";
import type {
  ChannelConfig,
  StoredAuth,
  TwitchClip,
  TwitchUser,
  TwitchValidationResponse
} from "../shared/types";

interface HelixResponse<T> {
  data: T[];
}

interface EventSubCreateResponse {
  data: Array<{
    id: string;
    status: string;
    type: string;
    version: string;
  }>;
}

interface CreateClipResponse {
  data: Array<{
    id: string;
    edit_url: string;
  }>;
}

interface TwitchStream {
  user_id: string;
  type: string;
}

export interface CreatedClip {
  id: string;
  editUrl: string;
}

export function getClipPageUrl(clipId: string): string {
  return `https://clips.twitch.tv/${encodeURIComponent(clipId)}`;
}

export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "TwitchApiError";
  }
}

export async function validateToken(
  accessToken: string
): Promise<TwitchValidationResponse> {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: {
      Authorization: `OAuth ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new TwitchApiError("Twitch authorization is no longer valid.", response.status);
  }

  return response.json() as Promise<TwitchValidationResponse>;
}

export async function resolveTwitchUser(
  login: string,
  auth: StoredAuth
): Promise<TwitchUser | null> {
  const url = new URL("https://api.twitch.tv/helix/users");
  url.searchParams.set("login", login);

  const response = await twitchFetch<HelixResponse<TwitchUser>>(url, auth);
  return response.data[0] ?? null;
}

export async function getRecentClips(
  broadcasterUserId: string,
  auth: StoredAuth,
  startedAt: Date,
  endedAt: Date
): Promise<TwitchClip[]> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("broadcaster_id", broadcasterUserId);
  url.searchParams.set("started_at", startedAt.toISOString());
  url.searchParams.set("ended_at", endedAt.toISOString());
  url.searchParams.set("first", "100");

  const response = await twitchFetch<HelixResponse<TwitchClip>>(url, auth);
  return response.data;
}

export async function getClipById(
  clipId: string,
  auth: StoredAuth
): Promise<TwitchClip | null> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("id", clipId);

  const response = await twitchFetch<HelixResponse<TwitchClip>>(url, auth);
  return response.data[0] ?? null;
}

export async function createClip(
  broadcasterUserId: string,
  auth: StoredAuth,
  durationSeconds: number
): Promise<CreatedClip> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("broadcaster_id", broadcasterUserId);
  url.searchParams.set("duration", String(durationSeconds));

  const response = await twitchFetch<CreateClipResponse>(url, auth, {
    method: "POST"
  });
  const clip = response.data[0];

  if (!clip) {
    throw new TwitchApiError("Twitch did not return a clip id.", 500);
  }

  return {
    id: clip.id,
    editUrl: clip.edit_url
  };
}

export async function isStreamLive(
  broadcasterUserId: string,
  auth: StoredAuth
): Promise<boolean> {
  const url = new URL("https://api.twitch.tv/helix/streams");
  url.searchParams.set("user_id", broadcasterUserId);
  url.searchParams.set("type", "live");
  url.searchParams.set("first", "1");

  const response = await twitchFetch<HelixResponse<TwitchStream>>(url, auth);
  return response.data.some(
    (stream) => stream.user_id === broadcasterUserId && stream.type === "live"
  );
}

export async function createChatMessageSubscription(
  channel: ChannelConfig,
  auth: StoredAuth,
  sessionId: string
): Promise<string> {
  const response = await twitchFetch<EventSubCreateResponse>(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    auth,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: channel.broadcasterUserId,
          user_id: auth.userId
        },
        transport: {
          method: "websocket",
          session_id: sessionId
        }
      })
    }
  );

  const subscription = response.data[0];
  if (!subscription) {
    throw new TwitchApiError("Twitch did not return a subscription id.", 500);
  }

  return subscription.id;
}

async function twitchFetch<T>(
  input: RequestInfo | URL,
  auth: StoredAuth,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...init.headers,
      "Client-ID": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${auth.accessToken}`
    }
  });

  if (!response.ok) {
    const code = await readTwitchErrorCode(response);
    throw new TwitchApiError(
      code.message || "Twitch API request failed.",
      response.status,
      code.error
    );
  }

  return response.json() as Promise<T>;
}

async function readTwitchErrorCode(
  response: Response
): Promise<{ error?: string; message?: string }> {
  try {
    return (await response.json()) as { error?: string; message?: string };
  } catch {
    return {};
  }
}
