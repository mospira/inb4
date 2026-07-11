import { describe, expect, it } from "vitest";
import { hasRequiredSpikeConfirmation } from "./spikeConfirmation";

const eligibleInput = {
  baselineReady: true,
  startupWarmupActive: false,
  notificationsEnabled: true,
  hasPendingChatConfirmation: true,
  recentClipCount: 1,
  spikeActive: false,
  notificationCooldownElapsed: true
};

describe("hasRequiredSpikeConfirmation", () => {
  it("accepts a pending chat anomaly corroborated by one recent clip", () => {
    expect(hasRequiredSpikeConfirmation(eligibleInput)).toBe(true);
  });

  it("rejects a chat anomaly when no recent clip exists", () => {
    expect(
      hasRequiredSpikeConfirmation({
        ...eligibleInput,
        recentClipCount: 0
      })
    ).toBe(false);
  });

  it("still enforces warmup, active-spike, and cooldown gates", () => {
    expect(
      hasRequiredSpikeConfirmation({
        ...eligibleInput,
        startupWarmupActive: true
      })
    ).toBe(false);
    expect(
      hasRequiredSpikeConfirmation({
        ...eligibleInput,
        spikeActive: true
      })
    ).toBe(false);
    expect(
      hasRequiredSpikeConfirmation({
        ...eligibleInput,
        notificationCooldownElapsed: false
      })
    ).toBe(false);
  });
});
