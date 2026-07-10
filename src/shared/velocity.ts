import {
  BASELINE_EXCLUSION_MS,
  BASELINE_LOOKBACK_MS,
  CHATTER_DATA_COVERAGE_RATIO,
  COLD_START_MS,
  DEFAULT_SETTINGS,
  DISTINCT_CHATTER_CONFIRMATION_SCORE,
  EMERGENCY_MESSAGES_PER_MINUTE,
  EMERGENCY_WINDOW_MS,
  MAX_DUPLICATE_IDS,
  MAX_TRACKED_CHANNELS,
  MIN_BASELINE_DISTINCT_CHATTERS,
  MIN_BASELINE_WINDOWS,
  SENSITIVITY_PRESETS,
  VELOCITY_BUCKET_MS,
  VELOCITY_CHECKPOINT_VERSION,
  VELOCITY_RETENTION_MS,
  VELOCITY_WINDOWS_MS,
  VELOCITY_WINDOW_MS
} from "./constants";
import type { VelocityWindowMs } from "./constants";
import type { SensitivityPreset, SensitivityPresetName } from "./types";

const VELOCITY_WINDOW_SECONDS = VELOCITY_WINDOW_MS / 1000;
const EMERGENCY_WINDOW_SECONDS = EMERGENCY_WINDOW_MS / 1000;

interface VelocityBucket {
  startedAt: number;
  messageCount: number;
  identifiedMessageCount: number;
  chatterUserIds: Set<string>;
}

interface ChannelVelocityState {
  buckets: Map<number, VelocityBucket>;
  seenMessageIds: string[];
  seenMessageIdSet: Set<string>;
  baselineStartedAt: number;
  spikeActive: boolean;
}

interface WindowEvaluation {
  windowMs: VelocityWindowMs;
  currentCount: number;
  baselineCount: number;
  standardDeviation: number;
  score: number;
  currentDistinctChatters: number;
  baselineDistinctChatters: number;
  chatterStandardDeviation: number;
  chatterScore: number;
  chatterDataCoverage: number;
  baselineSamples: number;
}

interface WindowCounts {
  messageCount: number;
  identifiedMessageCount: number;
  distinctChatters: number;
}

interface CoverageGap {
  startedAt: number;
  endedAt?: number;
}

export interface VelocityEngineCheckpoint {
  version: typeof VELOCITY_CHECKPOINT_VERSION;
  savedAt: number;
  channels: Array<{
    login: string;
    baselineStartedAt: number;
    spikeActive: boolean;
    buckets: Array<{
      startedAt: number;
      messageCount: number;
    }>;
    seenMessageIds: string[];
  }>;
  coverageGaps: CoverageGap[];
}

interface EvaluatedSnapshot {
  snapshot: VelocitySnapshot;
  windows: WindowEvaluation[];
}

export interface VelocitySnapshot {
  shortCount: number;
  shortRatePerSecond: number;
  baselineRatePerSecond: number;
  currentMessagesPerMinute: number;
  baselineMessagesPerMinute: number;
  spikeScore: number;
  spikeWindowMs: VelocityWindowMs;
  distinctChatters: number;
  chatterScore: number;
  baselineReady: boolean;
  spikeActive: boolean;
  baselineAgeMs: number;
}

export interface VelocityTrigger extends VelocitySnapshot {
  shouldNotify: boolean;
  multiplier: number;
  emergency: boolean;
}

export class VelocityEngine {
  private readonly states = new Map<string, ChannelVelocityState>();
  private readonly coverageGaps: CoverageGap[] = [];
  private openCoverageGap: CoverageGap | undefined;

  recordMessage(
    channelLogin: string,
    messageId: string,
    now = Date.now(),
    chatterUserId = ""
  ): boolean {
    const state = this.getState(channelLogin, now);
    state.baselineStartedAt = Math.min(state.baselineStartedAt, now);

    if (messageId && state.seenMessageIdSet.has(messageId)) {
      return false;
    }

    if (messageId) {
      state.seenMessageIds.push(messageId);
      state.seenMessageIdSet.add(messageId);

      while (state.seenMessageIds.length > MAX_DUPLICATE_IDS) {
        const oldId = state.seenMessageIds.shift();
        if (oldId) {
          state.seenMessageIdSet.delete(oldId);
        }
      }
    }

    const bucketStartedAt = this.getBucketStartedAt(now);
    const bucket = state.buckets.get(bucketStartedAt) ?? {
      startedAt: bucketStartedAt,
      messageCount: 0,
      identifiedMessageCount: 0,
      chatterUserIds: new Set<string>()
    };
    bucket.messageCount += 1;
    if (chatterUserId) {
      bucket.identifiedMessageCount += 1;
      bucket.chatterUserIds.add(chatterUserId);
    }
    state.buckets.set(bucketStartedAt, bucket);
    this.prune(state, now);

    return true;
  }

  evaluate(
    channelLogin: string,
    sensitivity: SensitivityPresetName = DEFAULT_SETTINGS.globalSensitivity,
    lastNotificationAt = 0,
    now = Date.now(),
    overrideCooldownSeconds?: number,
    options: { commitSpike?: boolean } = {}
  ): VelocityTrigger {
    const preset = this.getSensitivityPreset(sensitivity);
    const state = this.getState(channelLogin, now);
    this.prune(state, now);
    const evaluated = this.getSnapshotFromState(state, now);
    const snapshot = evaluated.snapshot;
    const emergencyCount = this.countBuckets(
      state,
      this.getBucketStartedAt(now - EMERGENCY_WINDOW_MS),
      this.getBucketStartedAt(now)
    );
    const emergencyMessagesPerMinute =
      (emergencyCount / EMERGENCY_WINDOW_SECONDS) * 60;
    const effectiveCooldownSeconds =
      overrideCooldownSeconds && overrideCooldownSeconds > 0
        ? overrideCooldownSeconds
        : DEFAULT_SETTINGS.defaultCooldownSeconds;
    const cooldownElapsed =
      !lastNotificationAt ||
      now - lastNotificationAt >= effectiveCooldownSeconds * 1000;
    const overBaseline =
      snapshot.baselineReady &&
      this.isSpikeCount(evaluated.windows, preset.strongChatScore);
    const emergency =
      !snapshot.baselineReady &&
      emergencyMessagesPerMinute >= EMERGENCY_MESSAGES_PER_MINUTE;
    const recovered = snapshot.baselineReady
      ? snapshot.spikeScore < preset.recoveryScore
      : !emergency;

    if (state.spikeActive && recovered) {
      state.spikeActive = false;
    }

    const shouldNotify = !state.spikeActive && cooldownElapsed && overBaseline;

    if (shouldNotify && options.commitSpike !== false) {
      state.spikeActive = true;
    }

    return {
      ...snapshot,
      spikeActive: state.spikeActive,
      shouldNotify,
      multiplier: this.getMultiplier(snapshot),
      emergency
    };
  }

  getSnapshot(
    channelLogin: string,
    sensitivity: SensitivityPresetName = DEFAULT_SETTINGS.globalSensitivity,
    now = Date.now()
  ): VelocitySnapshot {
    const preset = this.getSensitivityPreset(sensitivity);
    const state = this.getState(channelLogin, now);
    this.prune(state, now);
    const snapshot = this.getSnapshotFromState(state, now).snapshot;
    if (
      state.spikeActive &&
      snapshot.baselineReady &&
      snapshot.spikeScore < preset.recoveryScore
    ) {
      state.spikeActive = false;
    }

    return {
      ...snapshot,
      spikeActive: state.spikeActive
    };
  }

  clear(channelLogin?: string): void {
    if (channelLogin) {
      this.states.delete(channelLogin);
      return;
    }

    this.states.clear();
    this.coverageGaps.length = 0;
    this.openCoverageGap = undefined;
  }

  markUnavailable(now = Date.now()): void {
    if (this.openCoverageGap) {
      return;
    }

    this.openCoverageGap = { startedAt: now };
    this.coverageGaps.push(this.openCoverageGap);
  }

  markAvailable(now = Date.now()): void {
    if (!this.openCoverageGap) {
      return;
    }

    this.openCoverageGap.endedAt = Math.max(
      now,
      this.openCoverageGap.startedAt
    );
    this.openCoverageGap = undefined;
    this.pruneCoverageGaps(now);
  }

  exportState(now = Date.now()): VelocityEngineCheckpoint {
    for (const state of this.states.values()) {
      this.prune(state, now);
    }
    this.pruneCoverageGaps(now);

    return {
      version: VELOCITY_CHECKPOINT_VERSION,
      savedAt: now,
      channels: Array.from(this.states, ([login, state]) => ({
        login,
        baselineStartedAt: state.baselineStartedAt,
        spikeActive: state.spikeActive,
        buckets: Array.from(state.buckets.values(), (bucket) => ({
          startedAt: bucket.startedAt,
          messageCount: bucket.messageCount
        })),
        seenMessageIds: [...state.seenMessageIds]
      })),
      coverageGaps: this.coverageGaps.map((gap) => ({ ...gap }))
    };
  }

  importState(value: unknown, now = Date.now()): boolean {
    if (!this.isCheckpoint(value, now)) {
      return false;
    }

    this.clear();
    const maxBuckets = Math.ceil(VELOCITY_RETENTION_MS / VELOCITY_BUCKET_MS) + 2;

    for (const channel of value.channels.slice(0, MAX_TRACKED_CHANNELS)) {
      if (
        !this.isRecord(channel) ||
        typeof channel.login !== "string" ||
        channel.login.length === 0 ||
        channel.login.length > 100 ||
        !Number.isFinite(channel.baselineStartedAt) ||
        !Array.isArray(channel.buckets) ||
        !Array.isArray(channel.seenMessageIds)
      ) {
        continue;
      }

      const buckets = new Map<number, VelocityBucket>();
      for (const candidate of channel.buckets.slice(0, maxBuckets)) {
        if (
          !this.isRecord(candidate) ||
          !Number.isFinite(candidate.startedAt) ||
          candidate.startedAt % VELOCITY_BUCKET_MS !== 0 ||
          candidate.startedAt < now - VELOCITY_RETENTION_MS ||
          candidate.startedAt > now + VELOCITY_BUCKET_MS ||
          !Number.isInteger(candidate.messageCount) ||
          candidate.messageCount < 0 ||
          candidate.messageCount > 1_000_000
        ) {
          continue;
        }

        buckets.set(candidate.startedAt, {
          startedAt: candidate.startedAt,
          messageCount: candidate.messageCount,
          identifiedMessageCount: 0,
          chatterUserIds: new Set()
        });
      }

      const seenMessageIds = channel.seenMessageIds
        .filter(
          (messageId): messageId is string =>
            typeof messageId === "string" &&
            messageId.length > 0 &&
            messageId.length <= 256
        )
        .slice(-MAX_DUPLICATE_IDS);

      this.states.set(channel.login, {
        buckets,
        seenMessageIds,
        seenMessageIdSet: new Set(seenMessageIds),
        baselineStartedAt: Math.min(channel.baselineStartedAt, now),
        spikeActive: channel.spikeActive === true
      });
    }

    for (const candidate of value.coverageGaps.slice(0, maxBuckets)) {
      if (
        !this.isRecord(candidate) ||
        !Number.isFinite(candidate.startedAt) ||
        candidate.startedAt > now ||
        (candidate.endedAt !== undefined &&
          (!Number.isFinite(candidate.endedAt) ||
            candidate.endedAt < candidate.startedAt))
      ) {
        continue;
      }

      const gap: CoverageGap = {
        startedAt: candidate.startedAt,
        ...(candidate.endedAt !== undefined
          ? { endedAt: Math.min(candidate.endedAt, now) }
          : {})
      };
      this.coverageGaps.push(gap);
      if (gap.endedAt === undefined && !this.openCoverageGap) {
        this.openCoverageGap = gap;
      }
    }

    this.pruneCoverageGaps(now);
    return true;
  }

  activateSpike(channelLogin: string, now = Date.now()): void {
    const state = this.getState(channelLogin, now);
    state.spikeActive = true;
  }

  private getState(channelLogin: string, now: number): ChannelVelocityState {
    const existing = this.states.get(channelLogin);

    if (existing) {
      return existing;
    }

    const created: ChannelVelocityState = {
      buckets: new Map(),
      seenMessageIds: [],
      seenMessageIdSet: new Set(),
      baselineStartedAt: now,
      spikeActive: false
    };

    this.states.set(channelLogin, created);
    return created;
  }

  private prune(state: ChannelVelocityState, now: number): void {
    const minTimestamp = now - VELOCITY_RETENTION_MS;
    for (const bucketStartedAt of state.buckets.keys()) {
      if (bucketStartedAt < minTimestamp) {
        state.buckets.delete(bucketStartedAt);
      }
    }
  }

  private getSnapshotFromState(
    state: ChannelVelocityState,
    now: number
  ): EvaluatedSnapshot {
    const windows = VELOCITY_WINDOWS_MS.map((windowMs) =>
      this.evaluateWindow(state, now, windowMs)
    );
    const displayWindow =
      windows.find((window) => window.windowMs === VELOCITY_WINDOW_MS) ??
      windows[windows.length - 1];
    const strongestWindow = windows.reduce((strongest, candidate) =>
      candidate.score > strongest.score ? candidate : strongest
    );
    const shortCount = displayWindow.currentCount;
    const shortRatePerSecond = shortCount / VELOCITY_WINDOW_SECONDS;
    const baselineRatePerSecond =
      displayWindow.baselineCount / VELOCITY_WINDOW_SECONDS;
    const baselineAgeMs = now - state.baselineStartedAt;
    const currentWindowCovered = this.isRangeCovered(
      now - VELOCITY_WINDOW_MS,
      now
    );

    return {
      snapshot: {
        shortCount,
        shortRatePerSecond,
        baselineRatePerSecond,
        currentMessagesPerMinute: shortRatePerSecond * 60,
        baselineMessagesPerMinute: baselineRatePerSecond * 60,
        spikeScore: strongestWindow.score,
        spikeWindowMs: strongestWindow.windowMs,
        distinctChatters: strongestWindow.currentDistinctChatters,
        chatterScore: strongestWindow.chatterScore,
        baselineReady:
          baselineAgeMs >= COLD_START_MS &&
          currentWindowCovered &&
          windows.every(
            (window) => window.baselineSamples >= MIN_BASELINE_WINDOWS
          ),
        spikeActive: state.spikeActive,
        baselineAgeMs
      },
      windows
    };
  }

  private evaluateWindow(
    state: ChannelVelocityState,
    now: number,
    windowMs: VelocityWindowMs
  ): WindowEvaluation {
    const current = this.countWindowStats(state, now, windowMs);
    const currentCount = current.messageCount;
    const baselineSamples = this.getBaselineSamples(state, now, windowMs);
    const baselineMessageCounts = baselineSamples.map(
      (sample) => sample.messageCount
    );
    const baselineChatterCounts = baselineSamples.map(
      (sample) => sample.distinctChatters
    );
    const baselineCount = this.median(baselineMessageCounts);
    const medianAbsoluteDeviation = this.median(
      baselineMessageCounts.map((sample) => Math.abs(sample - baselineCount))
    );
    const standardDeviation = Math.max(
      medianAbsoluteDeviation * 1.4826,
      Math.sqrt(Math.max(baselineCount, 1))
    );
    const baselineDistinctChatters = this.median(baselineChatterCounts);
    const chatterMedianAbsoluteDeviation = this.median(
      baselineChatterCounts.map((sample) =>
        Math.abs(sample - baselineDistinctChatters)
      )
    );
    const chatterStandardDeviation = Math.max(
      chatterMedianAbsoluteDeviation * 1.4826,
      Math.sqrt(Math.max(baselineDistinctChatters, 1))
    );
    const baselineMessageTotal = baselineSamples.reduce(
      (total, sample) => total + sample.messageCount,
      0
    );
    const identifiedMessageTotal = baselineSamples.reduce(
      (total, sample) => total + sample.identifiedMessageCount,
      0
    );
    const currentCoverage =
      current.messageCount > 0
        ? current.identifiedMessageCount / current.messageCount
        : 1;
    const baselineCoverage =
      baselineMessageTotal > 0
        ? identifiedMessageTotal / baselineMessageTotal
        : 1;

    return {
      windowMs,
      currentCount,
      baselineCount,
      standardDeviation,
      score:
        baselineSamples.length > 0
          ? (currentCount - baselineCount) / standardDeviation
          : 0,
      currentDistinctChatters: current.distinctChatters,
      baselineDistinctChatters,
      chatterStandardDeviation,
      chatterScore:
        baselineSamples.length > 0
          ? (current.distinctChatters - baselineDistinctChatters) /
            chatterStandardDeviation
          : 0,
      chatterDataCoverage: Math.min(currentCoverage, baselineCoverage),
      baselineSamples: baselineSamples.length
    };
  }

  private isSpikeCount(
    windows: WindowEvaluation[],
    scoreThreshold: number
  ): boolean {
    return windows.some((window) => {
      const thresholdCount =
        window.baselineCount + scoreThreshold * window.standardDeviation;

      return (
        window.score >= scoreThreshold &&
        window.currentCount >= Math.ceil(thresholdCount) &&
        this.hasDistinctChatterConfirmation(window)
      );
    });
  }

  private hasDistinctChatterConfirmation(window: WindowEvaluation): boolean {
    if (
      window.chatterDataCoverage < CHATTER_DATA_COVERAGE_RATIO ||
      window.baselineDistinctChatters < MIN_BASELINE_DISTINCT_CHATTERS
    ) {
      return true;
    }

    return window.chatterScore >= DISTINCT_CHATTER_CONFIRMATION_SCORE;
  }

  private getBaselineSamples(
    state: ChannelVelocityState,
    now: number,
    windowMs: VelocityWindowMs
  ): WindowCounts[] {
    const currentBucketStartedAt = this.getBucketStartedAt(now);
    const earliestSampleStartedAt = Math.max(
      this.getBucketStartedAt(state.baselineStartedAt),
      currentBucketStartedAt - BASELINE_LOOKBACK_MS
    );
    const windowBucketCount = windowMs / VELOCITY_BUCKET_MS;
    const samples: WindowCounts[] = [];

    for (
      let sampleEndedAt = currentBucketStartedAt - BASELINE_EXCLUSION_MS;
      sampleEndedAt - (windowBucketCount - 1) * VELOCITY_BUCKET_MS >=
      earliestSampleStartedAt;
      sampleEndedAt -= windowMs
    ) {
      const sampleStartedAt =
        sampleEndedAt - (windowBucketCount - 1) * VELOCITY_BUCKET_MS;
      if (this.isRangeCovered(sampleStartedAt, sampleEndedAt)) {
        samples.push(
          this.countBucketStats(state, sampleStartedAt, sampleEndedAt)
        );
      }
    }

    return samples;
  }

  private countWindow(
    state: ChannelVelocityState,
    now: number,
    windowMs: number
  ): number {
    return this.countWindowStats(state, now, windowMs).messageCount;
  }

  private countWindowStats(
    state: ChannelVelocityState,
    now: number,
    windowMs: number
  ): WindowCounts {
    const currentBucketStartedAt = this.getBucketStartedAt(now);
    const windowBucketCount = windowMs / VELOCITY_BUCKET_MS;

    return this.countBucketStats(
      state,
      currentBucketStartedAt - (windowBucketCount - 1) * VELOCITY_BUCKET_MS,
      currentBucketStartedAt
    );
  }

  private countBuckets(
    state: ChannelVelocityState,
    firstBucketStartedAt: number,
    lastBucketStartedAt: number
  ): number {
    return this.countBucketStats(
      state,
      firstBucketStartedAt,
      lastBucketStartedAt
    ).messageCount;
  }

  private countBucketStats(
    state: ChannelVelocityState,
    firstBucketStartedAt: number,
    lastBucketStartedAt: number
  ): WindowCounts {
    let messageCount = 0;
    let identifiedMessageCount = 0;
    const chatterUserIds = new Set<string>();

    for (
      let bucketStartedAt = firstBucketStartedAt;
      bucketStartedAt <= lastBucketStartedAt;
      bucketStartedAt += VELOCITY_BUCKET_MS
    ) {
      const bucket = state.buckets.get(bucketStartedAt);
      if (!bucket) {
        continue;
      }

      messageCount += bucket.messageCount;
      identifiedMessageCount += bucket.identifiedMessageCount;
      for (const chatterUserId of bucket.chatterUserIds) {
        chatterUserIds.add(chatterUserId);
      }
    }

    return {
      messageCount,
      identifiedMessageCount,
      distinctChatters: chatterUserIds.size
    };
  }

  private median(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  private getBucketStartedAt(timestamp: number): number {
    return Math.floor(timestamp / VELOCITY_BUCKET_MS) * VELOCITY_BUCKET_MS;
  }

  private isRangeCovered(startedAt: number, endedAt: number): boolean {
    return !this.coverageGaps.some((gap) => {
      const gapEndedAt = gap.endedAt ?? Number.POSITIVE_INFINITY;
      return gap.startedAt <= endedAt && gapEndedAt > startedAt;
    });
  }

  private pruneCoverageGaps(now: number): void {
    const earliestRetainedAt = now - VELOCITY_RETENTION_MS;

    for (let index = this.coverageGaps.length - 1; index >= 0; index -= 1) {
      const gap = this.coverageGaps[index];
      if (gap.endedAt !== undefined && gap.endedAt < earliestRetainedAt) {
        this.coverageGaps.splice(index, 1);
      }
    }
  }

  private isCheckpoint(
    value: unknown,
    now: number
  ): value is VelocityEngineCheckpoint {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      value.version === VELOCITY_CHECKPOINT_VERSION &&
      typeof value.savedAt === "number" &&
      Number.isFinite(value.savedAt) &&
      value.savedAt <= now + VELOCITY_BUCKET_MS &&
      value.savedAt >= now - VELOCITY_RETENTION_MS &&
      Array.isArray(value.channels) &&
      Array.isArray(value.coverageGaps)
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private getMultiplier(snapshot: VelocitySnapshot): number {
    const oneMessagePerWindowRate = 1 / VELOCITY_WINDOW_SECONDS;
    const effectiveBaselineRate = Math.max(
      snapshot.baselineRatePerSecond,
      oneMessagePerWindowRate
    );

    return snapshot.shortRatePerSecond / effectiveBaselineRate;
  }

  private getSensitivityPreset(
    sensitivity: SensitivityPresetName | undefined
  ): SensitivityPreset {
    return (
      SENSITIVITY_PRESETS[sensitivity ?? DEFAULT_SETTINGS.globalSensitivity] ??
      SENSITIVITY_PRESETS[DEFAULT_SETTINGS.globalSensitivity]
    );
  }
}
