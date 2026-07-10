import { describe, expect, it } from "vitest";
import { VelocityEngine } from "./velocity";

const TEST_SENSITIVITY = "medium";

function warmBaseline(engine: VelocityEngine, login: string, start = 0): void {
  engine.recordMessage(login, `seed-${start}`, start);

  for (let time = start + 10_000; time <= start + 180_000; time += 10_000) {
    engine.recordMessage(login, `baseline-${time}`, time);
    engine.evaluate(login, TEST_SENSITIVITY, 0, time);
  }
}

describe("VelocityEngine", () => {
  it("suppresses normal threshold notifications during cold start", () => {
    const engine = new VelocityEngine();
    const login = "summit1g";

    for (let index = 0; index < 20; index += 1) {
      engine.recordMessage(login, `msg-${index}`, index * 100);
    }

    const result = engine.evaluate(login, TEST_SENSITIVITY, 0, 2_000);
    expect(result.shouldNotify).toBe(false);
  });

  it("tracks emergency cold-start activity without alerting before baseline is ready", () => {
    const engine = new VelocityEngine();
    const login = "summit1g";

    for (let index = 0; index < 50; index += 1) {
      engine.recordMessage(login, `msg-${index}`, index * 500);
    }

    const result = engine.evaluate(login, TEST_SENSITIVITY, 0, 30_000);
    expect(result.baselineReady).toBe(false);
    expect(result.emergency).toBe(true);
    expect(result.shouldNotify).toBe(false);
  });

  it("notifies after a baseline-backed spike and suppresses cooldown repeats", () => {
    const engine = new VelocityEngine();
    const login = "summit1g";
    warmBaseline(engine, login);

    for (let index = 0; index < 20; index += 1) {
      engine.recordMessage(login, `spike-${index}`, 181_000 + index * 25);
    }

    const first = engine.evaluate(login, TEST_SENSITIVITY, 0, 182_000);
    expect(first.shouldNotify).toBe(true);
    expect(first.spikeScore).toBeGreaterThan(3);

    const second = engine.evaluate(login, TEST_SENSITIVITY, 182_000, 183_000);
    expect(second.shouldNotify).toBe(false);
  });

  it("can evaluate a spike without committing active spike state", () => {
    const engine = new VelocityEngine();
    const login = "summit1g";
    warmBaseline(engine, login);

    for (let index = 0; index < 20; index += 1) {
      engine.recordMessage(login, `spike-${index}`, 181_000 + index * 25);
    }

    const first = engine.evaluate(login, TEST_SENSITIVITY, 0, 182_000, undefined, {
      commitSpike: false
    });
    const second = engine.evaluate(login, TEST_SENSITIVITY, 0, 182_500, undefined, {
      commitSpike: false
    });

    expect(first.shouldNotify).toBe(true);
    expect(second.shouldNotify).toBe(true);
    expect(engine.getSnapshot(login, TEST_SENSITIVITY, 182_500).spikeActive).toBe(
      false
    );
  });

  it("ignores duplicate message IDs", () => {
    const engine = new VelocityEngine();
    expect(engine.recordMessage("x", "same", 0)).toBe(true);
    expect(engine.recordMessage("x", "same", 1)).toBe(false);

    const snapshot = engine.getSnapshot("x", TEST_SENSITIVITY, 1_000);
    expect(snapshot.shortCount).toBe(1);
  });

  it("updates the adaptive EMA baseline gradually", () => {
    const engine = new VelocityEngine();
    const login = "summit1g";

    warmBaseline(engine, login);
    const warm = engine.getSnapshot(login, TEST_SENSITIVITY, 180_000);
    expect(warm.baselineReady).toBe(true);
    expect(warm.baselineMessagesPerMinute).toBeGreaterThan(0);

    const quiet = engine.getSnapshot(login, TEST_SENSITIVITY, 10 * 60_000);
    expect(quiet.baselineMessagesPerMinute).toBeLessThan(
      warm.baselineMessagesPerMinute
    );
  });

  it("can alert on a quiet channel without preset message minimums", () => {
    const engine = new VelocityEngine();
    const login = "quiet";

    engine.recordMessage(login, "seed", 0);
    for (let time = 5_000; time <= 180_000; time += 5_000) {
      engine.evaluate(login, TEST_SENSITIVITY, 0, time);
    }

    for (let index = 0; index < 4; index += 1) {
      engine.recordMessage(login, `spike-${index}`, 181_000 + index * 500);
    }

    const result = engine.evaluate(login, TEST_SENSITIVITY, 0, 183_000);
    expect(result.baselineReady).toBe(true);
    expect(result.shouldNotify).toBe(true);
  });

  it("prunes timestamps outside the retained rolling window", () => {
    const engine = new VelocityEngine();
    const login = "summit1g";

    engine.recordMessage(login, "old", 0);
    engine.recordMessage(login, "new", 16 * 60_000);

    const snapshot = engine.getSnapshot(
      login,
      TEST_SENSITIVITY,
      16 * 60_000
    );
    expect(snapshot.shortCount).toBe(1);
  });
});
