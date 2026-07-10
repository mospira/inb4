import {
  DEFAULT_SETTINGS,
  SENSITIVITY_PRESETS,
  VELOCITY_BUCKET_MS
} from "./constants";
import type { SensitivityPresetName, VelocityWindowMs } from "./constants";
import { VelocityEngine } from "./velocity";

export const VELOCITY_REPLAY_VERSION = 1;

export interface VelocityReplayBucket {
  startedAt: number;
  messageCount: number;
  chatterTokens?: string[];
  covered: boolean;
}

export interface VelocityReplayLabel {
  at: number;
  kind: string;
}

export interface VelocityReplayTrace {
  version: typeof VELOCITY_REPLAY_VERSION;
  traceId: string;
  datasetVersion: string;
  phase: "development" | "validation" | "test";
  channelLogin: string;
  sensitivity: SensitivityPresetName;
  cooldownSeconds?: number;
  labelMatchWindowMs?: number;
  buckets: VelocityReplayBucket[];
  labels?: VelocityReplayLabel[];
}

export interface VelocityReplayAlert {
  detectedAt: number;
  spikeScore: number;
  spikeWindowMs: VelocityWindowMs;
}

export interface VelocityReplayResult {
  traceId: string;
  datasetVersion: string;
  phase: VelocityReplayTrace["phase"];
  channelLogin: string;
  sensitivity: SensitivityPresetName;
  alerts: VelocityReplayAlert[];
  controls: {
    bucketCount: number;
    cooldownSeconds: number;
    labelMatchWindowMs: number;
  };
  metrics: {
    labelCount: number;
    matchedLabelCount: number;
    recall: number | null;
    falseAlertCount: number;
    medianDetectionLatencyMs: number | null;
  };
}

export class VelocityReplayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VelocityReplayValidationError";
  }
}

export function runVelocityReplay(value: unknown): VelocityReplayResult {
  const trace = validateTrace(value);
  const engine = new VelocityEngine();
  const alerts: VelocityReplayAlert[] = [];
  let coverageAvailable = true;
  let lastNotificationAt = 0;

  for (const bucket of trace.buckets) {
    if (bucket.covered !== coverageAvailable) {
      if (bucket.covered) {
        engine.markAvailable(bucket.startedAt);
      } else {
        engine.markUnavailable(bucket.startedAt);
      }
      coverageAvailable = bucket.covered;
    }

    const evaluatedAt = bucket.startedAt + VELOCITY_BUCKET_MS - 1;
    let evaluatedWithoutMessages = true;

    for (let index = 0; index < bucket.messageCount; index += 1) {
      const chatterTokens = bucket.chatterTokens ?? [];
      const chatterToken =
        chatterTokens.length > 0
          ? chatterTokens[index % chatterTokens.length]
          : "";
      engine.recordMessage(
        trace.channelLogin,
        `${bucket.startedAt}-${index}`,
        evaluatedAt,
        chatterToken,
        evaluatedAt
      );
      const trigger = engine.evaluate(
        trace.channelLogin,
        trace.sensitivity,
        lastNotificationAt,
        evaluatedAt,
        trace.cooldownSeconds
      );
      evaluatedWithoutMessages = false;

      if (trigger.shouldNotify) {
        alerts.push({
          detectedAt: evaluatedAt,
          spikeScore: trigger.spikeScore,
          spikeWindowMs: trigger.spikeWindowMs
        });
        lastNotificationAt = evaluatedAt;
      }
    }

    if (evaluatedWithoutMessages) {
      engine.evaluate(
        trace.channelLogin,
        trace.sensitivity,
        lastNotificationAt,
        evaluatedAt,
        trace.cooldownSeconds
      );
    }
  }

  return {
    traceId: trace.traceId,
    datasetVersion: trace.datasetVersion,
    phase: trace.phase,
    channelLogin: trace.channelLogin,
    sensitivity: trace.sensitivity,
    alerts,
    controls: {
      bucketCount: trace.buckets.length,
      cooldownSeconds:
        trace.cooldownSeconds ?? DEFAULT_SETTINGS.defaultCooldownSeconds,
      labelMatchWindowMs: trace.labelMatchWindowMs ?? 60_000
    },
    metrics: scoreAlerts(alerts, trace.labels ?? [], trace.labelMatchWindowMs)
  };
}

function validateTrace(value: unknown): VelocityReplayTrace {
  if (!isRecord(value)) {
    throw new VelocityReplayValidationError("Replay trace must be an object.");
  }
  if (value.version !== VELOCITY_REPLAY_VERSION) {
    throw new VelocityReplayValidationError("Unsupported replay trace version.");
  }
  if (typeof value.traceId !== "string" || value.traceId.length === 0) {
    throw new VelocityReplayValidationError("Replay trace requires a traceId.");
  }
  if (
    typeof value.datasetVersion !== "string" ||
    value.datasetVersion.length === 0
  ) {
    throw new VelocityReplayValidationError(
      "Replay trace requires a datasetVersion."
    );
  }
  if (
    value.phase !== "development" &&
    value.phase !== "validation" &&
    value.phase !== "test"
  ) {
    throw new VelocityReplayValidationError(
      "Replay trace requires a recognized phase."
    );
  }
  if (
    typeof value.channelLogin !== "string" ||
    value.channelLogin.length === 0
  ) {
    throw new VelocityReplayValidationError(
      "Replay trace requires a channelLogin."
    );
  }
  if (
    typeof value.sensitivity !== "string" ||
    !Object.prototype.hasOwnProperty.call(SENSITIVITY_PRESETS, value.sensitivity)
  ) {
    throw new VelocityReplayValidationError(
      "Replay trace has an unknown sensitivity."
    );
  }
  if (!Array.isArray(value.buckets) || value.buckets.length === 0) {
    throw new VelocityReplayValidationError(
      "Replay trace requires chronological one-second buckets."
    );
  }

  const buckets = value.buckets.map((bucket, index) =>
    validateBucket(bucket, index)
  );
  for (let index = 1; index < buckets.length; index += 1) {
    if (
      buckets[index].startedAt !==
      buckets[index - 1].startedAt + VELOCITY_BUCKET_MS
    ) {
      throw new VelocityReplayValidationError(
        "Replay buckets must be consecutive and chronological."
      );
    }
  }

  const labels = Array.isArray(value.labels)
    ? value.labels.map(validateLabel).sort((left, right) => left.at - right.at)
    : [];
  const lastBucketEndedAt =
    buckets[buckets.length - 1].startedAt + VELOCITY_BUCKET_MS - 1;
  if (
    labels.some(
      (label) =>
        label.at < buckets[0].startedAt || label.at > lastBucketEndedAt
    )
  ) {
    throw new VelocityReplayValidationError(
      "Replay labels must fall within the recorded timeline."
    );
  }

  const cooldownSeconds = validateOptionalPositiveNumber(
    value.cooldownSeconds,
    "cooldownSeconds"
  );
  const labelMatchWindowMs = validateOptionalPositiveNumber(
    value.labelMatchWindowMs,
    "labelMatchWindowMs"
  );

  return {
    version: VELOCITY_REPLAY_VERSION,
    traceId: value.traceId,
    datasetVersion: value.datasetVersion,
    phase: value.phase,
    channelLogin: value.channelLogin,
    sensitivity: value.sensitivity as SensitivityPresetName,
    ...(cooldownSeconds !== undefined ? { cooldownSeconds } : {}),
    ...(labelMatchWindowMs !== undefined ? { labelMatchWindowMs } : {}),
    buckets,
    labels
  };
}

function validateBucket(value: unknown, index: number): VelocityReplayBucket {
  if (
    !isRecord(value) ||
    typeof value.startedAt !== "number" ||
    !Number.isFinite(value.startedAt) ||
    value.startedAt % VELOCITY_BUCKET_MS !== 0 ||
    typeof value.messageCount !== "number" ||
    !Number.isInteger(value.messageCount) ||
    value.messageCount < 0 ||
    value.messageCount > 100_000 ||
    typeof value.covered !== "boolean"
  ) {
    throw new VelocityReplayValidationError(
      `Replay bucket ${index} is invalid.`
    );
  }
  if (!value.covered && value.messageCount > 0) {
    throw new VelocityReplayValidationError(
      `Replay bucket ${index} cannot contain messages without coverage.`
    );
  }

  if (
    value.chatterTokens !== undefined &&
    (!Array.isArray(value.chatterTokens) ||
      value.chatterTokens.some(
        (token) =>
          typeof token !== "string" || token.length === 0 || token.length > 128
      ))
  ) {
    throw new VelocityReplayValidationError(
      `Replay bucket ${index} has invalid chatter tokens.`
    );
  }
  const chatterTokens = Array.isArray(value.chatterTokens)
    ? (value.chatterTokens as string[])
    : [];
  if (
    chatterTokens.length > value.messageCount ||
    new Set(chatterTokens).size !== chatterTokens.length
  ) {
    throw new VelocityReplayValidationError(
      `Replay bucket ${index} has invalid chatter tokens.`
    );
  }

  return {
    startedAt: value.startedAt,
    messageCount: value.messageCount,
    covered: value.covered,
    ...(chatterTokens.length > 0 ? { chatterTokens } : {})
  };
}

function validateLabel(value: unknown): VelocityReplayLabel {
  if (
    !isRecord(value) ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    typeof value.kind !== "string" ||
    value.kind.length === 0
  ) {
    throw new VelocityReplayValidationError("Replay label is invalid.");
  }

  return { at: value.at, kind: value.kind };
}

function validateOptionalPositiveNumber(
  value: unknown,
  name: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new VelocityReplayValidationError(`${name} must be positive.`);
  }
  return value;
}

function scoreAlerts(
  alerts: VelocityReplayAlert[],
  labels: VelocityReplayLabel[],
  labelMatchWindowMs = 60_000
): VelocityReplayResult["metrics"] {
  const matchedAlertIndexes = new Set<number>();
  const latencies: number[] = [];

  for (const label of labels) {
    const alertIndex = alerts.findIndex(
      (alert, index) =>
        !matchedAlertIndexes.has(index) &&
        alert.detectedAt >= label.at &&
        alert.detectedAt <= label.at + labelMatchWindowMs
    );
    if (alertIndex >= 0) {
      matchedAlertIndexes.add(alertIndex);
      latencies.push(alerts[alertIndex].detectedAt - label.at);
    }
  }

  return {
    labelCount: labels.length,
    matchedLabelCount: latencies.length,
    recall: labels.length > 0 ? latencies.length / labels.length : null,
    falseAlertCount: alerts.length - matchedAlertIndexes.size,
    medianDetectionLatencyMs: median(latencies)
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
