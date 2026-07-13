import { SENSITIVITY_PRESETS } from "../shared/constants";
import type {
  PublicAppState,
  RuntimeCommand,
  RuntimeResponse
} from "../shared/types";
import type { SensitivityPresetName } from "../shared/types";

const COMMAND_TIMEOUT_MS = 20_000;

export async function sendCommand(command: RuntimeCommand): Promise<PublicAppState> {
  const response = await new Promise<RuntimeResponse<PublicAppState> | undefined>(
    (resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(
          new Error("Extension background did not respond. Reload the extension and try again.")
        );
      }, COMMAND_TIMEOUT_MS);

      chrome.runtime.sendMessage(command, (result: RuntimeResponse<PublicAppState>) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    }
  );

  if (!response) {
    throw new Error("Extension background did not respond. Reload the extension and try again.");
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data;
}

export function formatRate(value: number): string {
  if (!Number.isFinite(value)) {
    return "0/min";
  }

  if (value >= 100) {
    return `${Math.round(value)}/min`;
  }

  return `${value.toFixed(1)}/min`;
}

function renderRate(value: number): string {
  const rate = formatRate(value);
  const unit = "/min";

  if (!rate.endsWith(unit)) {
    return escapeHtml(rate);
  }

  return `<span class="metric-rate"><span class="metric-number">${escapeHtml(rate.slice(0, -unit.length))}</span><span class="metric-unit">${unit}</span></span>`;
}

export function formatTimeAgo(value: number | undefined): string {
  if (!value) {
    return "Never";
  }

  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sensitivityOptions(
  selected: SensitivityPresetName | undefined
): string {
  const presetOptions = (
    Object.entries(SENSITIVITY_PRESETS) as Array<
      [SensitivityPresetName, (typeof SENSITIVITY_PRESETS)[SensitivityPresetName]]
    >
  )
    .map(([value, preset]) => {
      const isSelected = selected === value ? "selected" : "";
      return `<option value="${value}" ${isSelected}>${escapeHtml(preset.label)}</option>`;
    })
    .join("");

  return presetOptions;
}

type ConnectionStatusTone = "ok" | "warn" | "error";

export function connectionStatus(state: PublicAppState): {
  tone: ConnectionStatusTone;
  label: string;
} {
  if (!state.auth) {
    return { tone: "error", label: "Twitch disconnected" };
  }

  switch (state.eventSub.socketState) {
    case "connected":
      return { tone: "ok", label: "Twitch connected" };
    case "connecting":
      return { tone: "warn", label: "Twitch connecting" };
    case "reconnecting":
      return { tone: "warn", label: "Twitch reconnecting" };
    case "idle":
      return {
        tone: "warn",
        label: state.channels.some((channel) => channel.enabled)
          ? "Twitch connected, tracking idle"
          : "Twitch connected, no enabled channels"
      };
    case "auth_required":
      return { tone: "error", label: "Twitch authorization required" };
    case "error":
      return { tone: "error", label: "Twitch tracking error" };
  }
}

export function renderConnectionStatusDot(state: PublicAppState): string {
  const status = connectionStatus(state);
  const label = escapeHtml(status.label);

  return `<span class="connection-dot ${status.tone}" role="img" aria-label="${label}" title="${label}"></span>`;
}

export function renderChannelIdentity(
  channel: PublicAppState["channels"][number]
): string {
  const displayName = channel.displayName || channel.login;
  const avatar = channel.profileImageUrl
    ? `<img class="channel-avatar" src="${escapeHtml(channel.profileImageUrl)}" alt="" referrerpolicy="no-referrer" />`
    : `<div class="channel-avatar placeholder">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</div>`;
  const loginLabel =
    displayName.toLowerCase() !== channel.login
      ? `<p class="muted">@${escapeHtml(channel.login)}</p>`
      : "";

  return `
    <div class="channel-identity">
      ${avatar}
      <div>
        <div class="channel-title">${escapeHtml(displayName)}</div>
        ${loginLabel}
      </div>
    </div>
  `;
}

export function renderAddChannelForm(isEnabled: boolean): string {
  return `
    <form class="add-form" data-add-form>
      <label class="field">
        <span>Add a channel</span>
        <input
          name="login"
          placeholder="e.g. tarik"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          ${isEnabled ? "" : "disabled"}
        />
      </label>
      <button class="primary" ${isEnabled ? "" : "disabled"}>Add</button>
    </form>
  `;
}

export function renderToggleControl(
  label: string,
  attributes: string,
  checked: boolean,
  disabled = false
): string {
  return `
    <label class="toggle-row">
      <input type="checkbox" ${attributes} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb"></span>
      </span>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

export function renderEmptyChannels(isAuthed: boolean): string {
  return `
    <div class="empty-state">
      <strong>No channels yet</strong>
      <p>${isAuthed ? "Add a Twitch channel to watch for chat spikes." : "Connect Twitch before adding channels."}</p>
    </div>
  `;
}

export function renderChannelMetrics(
  channel: PublicAppState["channels"][number]
): string {
  if (!channel.enabled) {
    return "";
  }

  const isObservingBaseline =
    !channel.baselineReady && !channel.errorMessage;

  if (isObservingBaseline) {
    return `
      <div class="channel-metrics observing-baseline" aria-label="Observing baseline before alerting">
        <div class="metric-card">
          <span class="baseline-placeholder label"></span>
          <strong class="baseline-placeholder value"></strong>
        </div>
        <div class="baseline-overlay">Observing baseline before alerting</div>
      </div>
    `;
  }

  return `
    <div class="channel-metrics" aria-label="Channel activity">
      <div class="metric-card">
        <span class="metric-label">Chat</span>
        <strong>${renderRate(channel.currentMessagesPerMinute)}</strong>
      </div>
    </div>
  `;
}

export function renderLoadingShell(shellClass: "shell" | "options-shell"): string {
  return `
    <main class="${shellClass}" aria-busy="true">
      <div class="loading-card">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </main>
  `;
}

export function renderLoadErrorShell(
  shellClass: "shell" | "options-shell",
  message: string
): string {
  return `
    <main class="${shellClass}">
      <div class="loading-card">
        <strong>Could not load extension state</strong>
        <p class="muted">${escapeHtml(message)}</p>
        <div class="actions">
          <button class="primary" data-action="retry-load">Retry</button>
        </div>
      </div>
    </main>
  `;
}

export function channelHeatStyle(spikeScore: number): string {
  const score = Number.isFinite(spikeScore) ? Math.max(0, spikeScore) : 0;
  const intensity = Math.min(1, score / 4);
  const [red, green, blue] =
    intensity < 0.5
      ? interpolateRgb([52, 211, 153], [245, 158, 11], intensity * 2)
      : interpolateRgb([245, 158, 11], [239, 68, 68], (intensity - 0.5) * 2);
  const alpha = 0.04 + intensity * 0.32;
  const softAlpha = alpha * 0.45;
  const borderAlpha = 0.22 + intensity * 0.48;

  return [
    `--heat-rgb: ${red} ${green} ${blue}`,
    `--heat-alpha: ${alpha.toFixed(3)}`,
    `--heat-alpha-soft: ${softAlpha.toFixed(3)}`,
    `--heat-border-alpha: ${borderAlpha.toFixed(3)}`
  ].join("; ");
}

function interpolateRgb(
  from: [number, number, number],
  to: [number, number, number],
  amount: number
): [number, number, number] {
  return from.map((value, index) =>
    Math.round(value + (to[index] - value) * amount)
  ) as [number, number, number];
}
