import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredAuth } from "../shared/types";
import {
  createClip,
  createChatMessageSubscription,
  getClipById,
  getClipPageUrl,
  getRecentClips,
  isStreamLive,
  resolveTwitchUser,
  validateToken
} from "./twitchApi";

const auth: StoredAuth = {
  accessToken: "token",
  expiresAt: Date.now() + 1000,
  userId: "viewer-id",
  login: "viewer",
  scopes: ["user:read:chat", "clips:edit"],
  connectedAt: Date.now()
};

describe("twitchApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates OAuth tokens with Twitch's OAuth authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          client_id: "client",
          login: "viewer",
          scopes: ["user:read:chat", "clips:edit"],
          user_id: "viewer-id",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await validateToken("abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://id.twitch.tv/oauth2/validate",
      expect.objectContaining({
        headers: {
          Authorization: "OAuth abc"
        }
      })
    );
  });

  it("resolves Twitch users by login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "123",
                login: "summit1g",
                display_name: "summit1g",
                profile_image_url: "https://static-cdn.jtvnw.net/summit1g.png"
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    await expect(resolveTwitchUser("summit1g", auth)).resolves.toEqual({
      id: "123",
      login: "summit1g",
      display_name: "summit1g",
      profile_image_url: "https://static-cdn.jtvnw.net/summit1g.png"
    });
  });

  it("gets recent clips by broadcaster and time window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "clip-id",
              created_at: "2026-07-05T01:00:00Z"
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getRecentClips(
        "123",
        auth,
        new Date("2026-07-05T00:55:00Z"),
        new Date("2026-07-05T01:05:00Z")
      )
    ).resolves.toEqual([
      {
        id: "clip-id",
        created_at: "2026-07-05T01:00:00Z"
      }
    ]);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://api.twitch.tv/helix/clips?broadcaster_id=123&started_at=2026-07-05T00%3A55%3A00.000Z&ended_at=2026-07-05T01%3A05%3A00.000Z&first=100"
    );
  });

  it("gets a created clip by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "clip-id",
              created_at: "2026-07-09T00:00:00Z"
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getClipById("clip-id", auth)).resolves.toEqual({
      id: "clip-id",
      created_at: "2026-07-09T00:00:00Z"
    });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.twitch.tv/helix/clips?id=clip-id");
  });

  it("returns null when a created clip is not available yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: []
          }),
          { status: 200 }
        )
      )
    );

    await expect(getClipById("clip-id", auth)).resolves.toBeNull();
  });

  it("creates clips with the requested duration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "clip-id",
              edit_url: "https://www.twitch.tv/twitchdev/clip/clip-id"
            }
          ]
        }),
        { status: 202 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClip("123", auth, 60)).resolves.toEqual({
      id: "clip-id",
      editUrl: "https://www.twitch.tv/twitchdev/clip/clip-id"
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://api.twitch.tv/helix/clips?broadcaster_id=123&duration=60"
    );
    expect(init.method).toBe("POST");
  });

  it("builds public clip URLs from clip ids", () => {
    expect(getClipPageUrl("FineClipSlug")).toBe(
      "https://clips.twitch.tv/FineClipSlug"
    );
  });

  it("checks whether a broadcaster is live", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ user_id: "123", type: "live" }]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(isStreamLive("123", auth)).resolves.toBe(true);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://api.twitch.tv/helix/streams?user_id=123&type=live&first=1"
    );
  });

  it("treats an empty streams response as offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: []
          }),
          { status: 200 }
        )
      )
    );

    await expect(isStreamLive("123", auth)).resolves.toBe(false);
  });

  it("creates channel.chat.message websocket subscriptions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "sub-id", status: "enabled", type: "channel.chat.message" }]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createChatMessageSubscription(
        {
          login: "summit1g",
          broadcasterUserId: "123",
          enabled: true,
          createClipsEnabled: true,
          sensitivity: "medium"
        },
        auth,
        "session-id"
      )
    ).resolves.toBe("sub-id");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      type: "channel.chat.message",
      version: "1",
      condition: {
        broadcaster_user_id: "123",
        user_id: "viewer-id"
      },
      transport: {
        method: "websocket",
        session_id: "session-id"
      }
    });
  });
});
