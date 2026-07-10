import { describe, expect, it } from "vitest";
import { ClipSignalTracker } from "./clipSignal";

describe("ClipSignalTracker", () => {
  it("dedupes clips and counts only recent clips", () => {
    const tracker = new ClipSignalTracker();
    const now = 10 * 60_000;

    expect(
      tracker.recordClips(
        "summit1g",
        [
          { id: "old", createdAt: now - 6 * 60_000 },
          { id: "recent-1", createdAt: now - 30_000 },
          { id: "recent-2", createdAt: now - 10_000 },
          { id: "recent-2", createdAt: now - 10_000 }
        ],
        now
      )
    ).toBe(3);

    expect(tracker.getSnapshot("summit1g", now).recentClipCount).toBe(2);
  });

  it("forgets retained clip ids after retention", () => {
    const tracker = new ClipSignalTracker();
    tracker.recordClips("summit1g", [{ id: "clip", createdAt: 0 }], 0);

    expect(
      tracker.recordClips(
        "summit1g",
        [{ id: "clip", createdAt: 61 * 60_000 }],
        61 * 60_000
      )
    ).toBe(1);
  });
});
