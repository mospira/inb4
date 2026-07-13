import { CLIP_CONFIRMATION_MIN_COUNT } from "../shared/constants";

interface SpikeConfirmationInput {
  baselineReady: boolean;
  startupWarmupActive: boolean;
  notificationsEnabled: boolean;
  hasPendingChatConfirmation: boolean;
  recentClipCount: number;
  spikeActive: boolean;
  notificationCooldownElapsed: boolean;
}

export function hasRequiredSpikeConfirmation({
  baselineReady,
  startupWarmupActive,
  notificationsEnabled,
  hasPendingChatConfirmation,
  recentClipCount,
  spikeActive,
  notificationCooldownElapsed
}: SpikeConfirmationInput): boolean {
  return (
    baselineReady &&
    !startupWarmupActive &&
    notificationsEnabled &&
    hasPendingChatConfirmation &&
    recentClipCount >= CLIP_CONFIRMATION_MIN_COUNT &&
    !spikeActive &&
    notificationCooldownElapsed
  );
}
