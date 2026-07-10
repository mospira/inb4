import {
  BASELINE_EMA_ALPHA,
  BASELINE_SAMPLE_INTERVAL_MS,
  COLD_START_MS,
  DEFAULT_SETTINGS,
  EMERGENCY_MESSAGES_PER_MINUTE,
  EMERGENCY_WINDOW_MS,
  MAX_DUPLICATE_IDS,
  MAX_TIMESTAMP_AGE_MS,
  SENSITIVITY_PRESETS,
  VELOCITY_WINDOW_MS
} from "./constants";
import type { SensitivityPreset, SensitivityPresetName } from "./types";

const VELOCITY_WINDOW_SECONDS = VELOCITY_WINDOW_MS / 1000;
const EMERGENCY_WINDOW_SECONDS = EMERGENCY_WINDOW_MS / 1000;

interface ChannelVelocityState {
  timestamps: number[];
  seenMessageIds: string[];
  seenMessageIdSet: Set<string>;
  baselineCount: number;
  baselineVariance: number;
  baselineSamples: number;
  baselineStartedAt: number;
  lastBaselineSampleAt: number;
  spikeActive: boolean;
}

export interface VelocitySnapshot {
  shortCount: number;
  shortRatePerSecond: number;
  baselineRatePerSecond: number;
  currentMessagesPerMinute: number;
  baselineMessagesPerMinute: number;
  spikeScore: number;
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

  recordMessage(channelLogin: string, messageId: string, now = Date.now()): boolean {
    const state = this.getState(channelLogin, now);

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

    state.timestamps.push(now);
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
    this.advanceBaseline(state, now, preset.strongChatScore);

    const snapshot = this.getSnapshotFromState(state, now);
    const emergencyCount = this.countBetween(
      state,
      now - EMERGENCY_WINDOW_MS,
      now
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
      this.isSpikeCount(
        state,
        snapshot.shortCount,
        snapshot.spikeScore,
        preset.strongChatScore
      );
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
    this.advanceBaseline(state, now, preset.strongChatScore);

    const snapshot = this.getSnapshotFromState(state, now);
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
      timestamps: [],
      seenMessageIds: [],
      seenMessageIdSet: new Set(),
      baselineCount: 0,
      baselineVariance: 0,
      baselineSamples: 0,
      baselineStartedAt: now,
      lastBaselineSampleAt: now,
      spikeActive: false
    };

    this.states.set(channelLogin, created);
    return created;
  }

  private prune(state: ChannelVelocityState, now: number): void {
    const minTimestamp = now - MAX_TIMESTAMP_AGE_MS;
    while (state.timestamps.length > 0 && state.timestamps[0] < minTimestamp) {
      state.timestamps.shift();
    }
  }

  private advanceBaseline(
    state: ChannelVelocityState,
    now: number,
    spikeScoreThreshold: number
  ): void {
    const oldestUsefulSampleAt = now - MAX_TIMESTAMP_AGE_MS;
    if (state.lastBaselineSampleAt < oldestUsefulSampleAt) {
      state.lastBaselineSampleAt = oldestUsefulSampleAt;
    }

    while (state.lastBaselineSampleAt + BASELINE_SAMPLE_INTERVAL_MS <= now) {
      const sampleAt = state.lastBaselineSampleAt + BASELINE_SAMPLE_INTERVAL_MS;
      const sampleAgeMs = sampleAt - state.baselineStartedAt;
      const sampleCount = this.countBetween(
        state,
        sampleAt - VELOCITY_WINDOW_MS,
        sampleAt
      );
      const sampleReady =
        sampleAgeMs >= COLD_START_MS && state.baselineSamples > 0;
      const sampleScore = this.getSpikeScore(state, sampleCount);
      const sampleIsSpike =
        sampleReady &&
        this.isSpikeCount(
          state,
          sampleCount,
          sampleScore,
          spikeScoreThreshold
        );

      if (!sampleIsSpike && (!state.spikeActive || !sampleReady)) {
        this.updateBaseline(state, sampleCount);
      }

      state.lastBaselineSampleAt = sampleAt;
    }
  }

  private updateBaseline(state: ChannelVelocityState, count: number): void {
    if (state.baselineSamples === 0) {
      state.baselineCount = count;
      state.baselineVariance = 0;
      state.baselineSamples = 1;
      return;
    }

    const delta = count - state.baselineCount;
    const nextMean = state.baselineCount + BASELINE_EMA_ALPHA * delta;
    const nextVariance =
      (1 - BASELINE_EMA_ALPHA) *
      (state.baselineVariance + BASELINE_EMA_ALPHA * delta * delta);

    state.baselineCount = nextMean;
    state.baselineVariance = Math.max(0, nextVariance);
    state.baselineSamples += 1;
  }

  private getSnapshotFromState(
    state: ChannelVelocityState,
    now: number
  ): VelocitySnapshot {
    const shortCount = this.countBetween(
      state,
      now - VELOCITY_WINDOW_MS,
      now
    );
    const shortRatePerSecond = shortCount / VELOCITY_WINDOW_SECONDS;
    const baselineRatePerSecond =
      state.baselineCount / VELOCITY_WINDOW_SECONDS;
    const baselineAgeMs = now - state.baselineStartedAt;

    return {
      shortCount,
      shortRatePerSecond,
      baselineRatePerSecond,
      currentMessagesPerMinute: shortRatePerSecond * 60,
      baselineMessagesPerMinute: baselineRatePerSecond * 60,
      spikeScore: this.getSpikeScore(state, shortCount),
      baselineReady:
        baselineAgeMs >= COLD_START_MS && state.baselineSamples > 0,
      spikeActive: state.spikeActive,
      baselineAgeMs
    };
  }

  private countBetween(
    state: ChannelVelocityState,
    minTimestamp: number,
    maxTimestamp: number
  ): number {
    let count = 0;

    for (let index = state.timestamps.length - 1; index >= 0; index -= 1) {
      const timestamp = state.timestamps[index];

      if (timestamp > maxTimestamp) {
        continue;
      }

      if (timestamp < minTimestamp) {
        break;
      }

      count += 1;
    }

    return count;
  }

  private getSpikeScore(state: ChannelVelocityState, count: number): number {
    if (state.baselineSamples === 0) {
      return 0;
    }

    return (count - state.baselineCount) / this.getBaselineStdDev(state);
  }

  private getBaselineStdDev(state: ChannelVelocityState): number {
    return Math.max(
      Math.sqrt(state.baselineVariance),
      Math.sqrt(Math.max(state.baselineCount, 1))
    );
  }

  private isSpikeCount(
    state: ChannelVelocityState,
    count: number,
    score: number,
    scoreThreshold: number
  ): boolean {
    const thresholdCount =
      state.baselineCount + scoreThreshold * this.getBaselineStdDev(state);

    return score >= scoreThreshold && count >= Math.ceil(thresholdCount);
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
