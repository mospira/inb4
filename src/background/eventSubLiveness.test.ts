import { describe, expect, it } from "vitest";
import {
  getEventSubKeepaliveTimeoutSeconds,
  isEventSubLivenessExpired
} from "./eventSubLiveness";

describe("eventSubLiveness", () => {
  it("uses Twitch's keepalive timeout when it is valid", () => {
    expect(getEventSubKeepaliveTimeoutSeconds(15)).toBe(15);
  });

  it("falls back when Twitch omits an invalid timeout", () => {
    expect(getEventSubKeepaliveTimeoutSeconds(undefined)).toBe(20);
    expect(getEventSubKeepaliveTimeoutSeconds(-1)).toBe(20);
  });

  it("expires a half-open socket after timeout plus grace", () => {
    expect(
      isEventSubLivenessExpired({
        lastMessageAt: 1_000,
        keepaliveTimeoutSeconds: 20,
        now: 26_001,
        graceMs: 5_000
      })
    ).toBe(true);
  });

  it("does not expire a socket inside the liveness window", () => {
    expect(
      isEventSubLivenessExpired({
        lastMessageAt: 1_000,
        keepaliveTimeoutSeconds: 20,
        now: 26_000,
        graceMs: 5_000
      })
    ).toBe(false);
  });
});
