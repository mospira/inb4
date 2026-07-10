import {
  TWITCH_CLIPS_EDIT_SCOPE,
  TWITCH_CLIP_AUTH_SCOPE,
  TWITCH_AUTH_SCOPE,
  TWITCH_AUTH_SCOPES,
  TWITCH_CLIENT_ID
} from "../shared/constants";
import type { StoredAuth } from "../shared/types";
import { validateToken } from "./twitchApi";

interface OAuthFragment {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: string;
  scope?: string;
  state?: string;
  token_type?: string;
}

export function getTwitchRedirectUri(): string {
  return chrome.identity.getRedirectURL("twitch");
}

export async function connectTwitch(includeClipScope = false): Promise<StoredAuth> {
  const state = createOAuthState();
  const authUrl = createTwitchAuthorizationUrl(state, includeClipScope);

  const redirectUrl = await launchWebAuthFlow(authUrl.toString());
  const fragment = parseOAuthRedirect(redirectUrl);

  if (fragment.error) {
    throw new Error(
      fragment.error_description || `Twitch authorization failed: ${fragment.error}.`
    );
  }

  if (fragment.state !== state) {
    throw new Error("Twitch authorization state did not match.");
  }

  if (!fragment.access_token) {
    throw new Error("Twitch did not return an access token.");
  }

  const validation = await validateToken(fragment.access_token);

  if (validation.client_id !== TWITCH_CLIENT_ID) {
    throw new Error("Twitch returned a token for a different application.");
  }

  if (!hasRequiredTwitchScopes(validation.scopes)) {
    throw new Error(
      `Twitch token is missing required scopes: ${TWITCH_AUTH_SCOPE}.`
    );
  }

  if (includeClipScope && !hasClipEditScope(validation.scopes)) {
    throw new Error(
      `Twitch token is missing required scopes: ${TWITCH_CLIP_AUTH_SCOPE}.`
    );
  }

  return {
    accessToken: fragment.access_token,
    expiresAt: Date.now() + validation.expires_in * 1000,
    userId: validation.user_id,
    login: validation.login,
    scopes: validation.scopes,
    connectedAt: Date.now()
  };
}

export function createTwitchAuthorizationUrl(
  state: string,
  includeClipScope = false
): URL {
  const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authUrl.searchParams.set("client_id", TWITCH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", getTwitchRedirectUri());
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set(
    "scope",
    includeClipScope ? TWITCH_CLIP_AUTH_SCOPE : TWITCH_AUTH_SCOPE
  );
  authUrl.searchParams.set("state", state);

  return authUrl;
}

export function hasRequiredTwitchScopes(scopes: readonly string[]): boolean {
  return TWITCH_AUTH_SCOPES.every((scope) => scopes.includes(scope));
}

export function hasClipEditScope(scopes: readonly string[]): boolean {
  return scopes.includes(TWITCH_CLIPS_EDIT_SCOPE);
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url,
        interactive: true
      },
      (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(createOAuthLoadError(chrome.runtime.lastError.message)));
          return;
        }

        if (!redirectUrl) {
          reject(new Error("Twitch authorization was cancelled."));
          return;
        }

        resolve(redirectUrl);
      }
    );
  });
}

function createOAuthLoadError(message = "Authorization page could not be loaded."): string {
  if (message.toLowerCase().includes("authorization page could not be loaded")) {
    return [
      "Twitch authorization page could not be loaded.",
      "Register this exact OAuth redirect URL in your Twitch developer app, then reload the extension:",
      getTwitchRedirectUri()
    ].join(" ");
  }

  return message;
}

export function parseOAuthRedirect(redirectUrl: string): OAuthFragment {
  const url = new URL(redirectUrl);
  const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const queryParams = url.searchParams;

  return {
    access_token: getOAuthParam("access_token", fragmentParams, queryParams),
    error: getOAuthParam("error", queryParams, fragmentParams),
    error_description: getOAuthParam(
      "error_description",
      queryParams,
      fragmentParams
    ),
    expires_in: getOAuthParam("expires_in", fragmentParams, queryParams),
    scope: getOAuthParam("scope", fragmentParams, queryParams),
    state: getOAuthParam("state", fragmentParams, queryParams),
    token_type: getOAuthParam("token_type", fragmentParams, queryParams)
  };
}

function getOAuthParam(
  name: string,
  primary: URLSearchParams,
  fallback: URLSearchParams
): string | undefined {
  return primary.get(name) ?? fallback.get(name) ?? undefined;
}

function createOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
