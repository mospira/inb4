import { describe, expect, it } from "vitest";
import { resolveEventTimestamp } from "./eventTimestamp";

describe("resolveEventTimestamp", () => {
  const receivedAt = Date.parse("2026-07-09T00:10:00Z");

  it("uses Twitch event time and safely truncates nanoseconds", () => {
    expect(
      resolveEventTimestamp("2026-07-09T00:09:59.123456789Z", receivedAt)
    ).toBe(Date.parse("2026-07-09T00:09:59.123Z"));
  });

  it("clamps small future clock skew to receipt time", () => {
    expect(
      resolveEventTimestamp("2026-07-09T00:10:10Z", receivedAt)
    ).toBe(receivedAt);
  });

  it("rejects malformed, stale, and implausibly future timestamps", () => {
    expect(resolveEventTimestamp("not-a-date", receivedAt)).toBeNull();
    expect(
      resolveEventTimestamp("2026-07-08T23:59:59Z", receivedAt)
    ).toBeNull();
    expect(
      resolveEventTimestamp("2026-07-09T00:10:31Z", receivedAt)
    ).toBeNull();
  });
});
