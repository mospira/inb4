import { describe, expect, it } from "vitest";
import { StartupNotificationWarmup } from "./startupWarmup";

describe("StartupNotificationWarmup", () => {
  it("is inactive until startup warmup begins", () => {
    const warmup = new StartupNotificationWarmup(180_000);

    expect(warmup.isActive(1_000)).toBe(false);
  });

  it("mutes notifications until the warmup duration has elapsed", () => {
    const warmup = new StartupNotificationWarmup(180_000);

    warmup.start(10_000);

    expect(warmup.isActive(189_999)).toBe(true);
    expect(warmup.isActive(190_000)).toBe(false);
  });
});
