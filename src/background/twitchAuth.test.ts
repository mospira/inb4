import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTwitchAuthorizationUrl,
  hasClipEditScope,
  hasRequiredTwitchScopes,
  parseOAuthRedirect
} from "./twitchAuth";

describe("twitchAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses successful implicit grant redirects from the fragment", () => {
    expect(
      parseOAuthRedirect(
        "https://example.chromiumapp.org/twitch#access_token=token-123&expires_in=14400&scope=user%3Aread%3Achat+clips%3Aedit&state=state-123&token_type=bearer"
      )
    ).toEqual({
      access_token: "token-123",
      error: undefined,
      error_description: undefined,
      expires_in: "14400",
      scope: "user:read:chat clips:edit",
      state: "state-123",
      token_type: "bearer"
    });
  });

  it("parses Twitch OAuth errors from the query string", () => {
    expect(
      parseOAuthRedirect(
        "https://example.chromiumapp.org/twitch?error=access_denied&error_description=The+user+denied+you+access&state=state-123"
      )
    ).toMatchObject({
      error: "access_denied",
      error_description: "The user denied you access",
      state: "state-123"
    });
  });

  it("requires chat-read scope for base tracking", () => {
    expect(hasRequiredTwitchScopes(["user:read:chat", "clips:edit"])).toBe(true);
    expect(hasRequiredTwitchScopes(["user:read:chat"])).toBe(true);
    expect(hasRequiredTwitchScopes(["clips:edit"])).toBe(false);
  });

  it("detects optional clip-edit scope", () => {
    expect(hasClipEditScope(["user:read:chat", "clips:edit"])).toBe(true);
    expect(hasClipEditScope(["user:read:chat"])).toBe(false);
  });

  it("requests clip scope only when explicitly requested", () => {
    vi.stubGlobal("chrome", {
      identity: {
        getRedirectURL: (path: string) => `https://example.chromiumapp.org/${path}`
      }
    });

    const baseUrl = createTwitchAuthorizationUrl("state-123");
    const clipUrl = createTwitchAuthorizationUrl("state-123", true);

    expect(baseUrl.searchParams.get("scope")).toBe("user:read:chat");
    expect(clipUrl.searchParams.get("scope")).toBe("user:read:chat clips:edit");
  });
});
