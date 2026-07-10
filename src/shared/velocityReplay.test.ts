import { describe, expect, it } from "vitest";
import {
  runVelocityReplay,
  VelocityReplayValidationError,
  type VelocityReplayTrace
} from "./velocityReplay";

function createBusyTrace(): VelocityReplayTrace {
  return {
    version: 1,
    traceId: "busy-session",
    datasetVersion: "fixture-v1",
    phase: "test",
    channelLogin: "busy",
    sensitivity: "high",
    cooldownSeconds: 60,
    labelMatchWindowMs: 30_000,
    buckets: Array.from({ length: 365 }, (_, second) => {
      const surge = second >= 360;
      const messageCount = surge ? 30 : 20;
      return {
        startedAt: second * 1_000,
        messageCount,
        chatterTokens: Array.from(
          { length: surge ? 30 : 20 },
          (_unused, chatter) => `chatter-${chatter}`
        ),
        covered: true
      };
    }),
    labels: [{ at: 360_000, kind: "manual-moment" }]
  };
}

describe("runVelocityReplay", () => {
  it("replays a high-volume surge through the production detector", () => {
    const result = runVelocityReplay(createBusyTrace());

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].detectedAt).toBeGreaterThanOrEqual(360_000);
    expect(result.metrics).toMatchObject({
      labelCount: 1,
      matchedLabelCount: 1,
      recall: 1,
      falseAlertCount: 0,
      falseAlertsPerCoveredHour: 0
    });
    expect(result.metrics.coveredHours).toBeCloseTo(365 / 3_600);
  });

  it("keeps future labels out of detector decisions", () => {
    const trace = createBusyTrace();
    const withoutLabels = runVelocityReplay({ ...trace, labels: [] });
    const withLabels = runVelocityReplay(trace);

    expect(withLabels.alerts).toEqual(withoutLabels.alerts);
  });

  it("rejects missing or non-chronological coverage buckets", () => {
    const trace = createBusyTrace();
    trace.buckets.splice(100, 1);

    expect(() => runVelocityReplay(trace)).toThrow(
      VelocityReplayValidationError
    );
  });
});
