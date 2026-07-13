import type { PublicAppState, SensitivityPresetName } from "../shared/types";
import {
  channelHeatStyle,
  escapeHtml,
  formatTimeAgo,
  renderConnectionStatusDot,
  renderAddChannelForm,
  renderChannelMetrics,
  renderChannelIdentity,
  renderEmptyChannels,
  renderLoadErrorShell,
  renderLoadingShell,
  renderToggleControl,
  sendCommand,
  sensitivityOptions
} from "../ui/client";
import "../ui/styles.css";

const appElement = document.querySelector<HTMLDivElement>("#app");
let state: PublicAppState | null = null;
let busy = false;
let flash = "";
let flashIsError = false;
let loadError = "";

if (!appElement) {
  throw new Error("Missing app root.");
}

const app = appElement;

void refresh();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refresh(false);
  }
});

async function refresh(showErrors = true): Promise<void> {
  try {
    state = await sendCommand({ type: "GET_STATE" });
    loadError = "";
    render();
  } catch (error) {
    if (showErrors) {
      loadError = error instanceof Error ? error.message : "Unexpected error.";
      render();
    }
  }
}

function render(): void {
  if (!state) {
    app.innerHTML = loadError
      ? renderLoadErrorShell("shell", loadError)
      : renderLoadingShell("shell");
    bindLoadRetry();
    return;
  }

  const disabled = busy ? "disabled" : "";
  const enabledCount = state.channels.filter((channel) => channel.enabled).length;
  const authActions = state.auth
    ? [
        `<button data-action="disconnect" ${disabled}>Disconnect</button>`,
        `<button data-action="reconnect" ${disabled}>Reconnect</button>`
      ].join("")
    : `<button class="primary" data-action="connect" ${disabled}>Connect Twitch</button>`;

  app.innerHTML = `
    <main class="shell">
      <div class="topbar">
        <div class="brand">
          <div class="brand-title">
            <a class="brand-link" href="https://github.com/mospira/inb4" target="_blank" rel="noreferrer" aria-label="View inb4 on GitHub">
              <img class="mark" src="/icons/icon128.svg" alt="inb4">
            </a>
            ${renderConnectionStatusDot(state)}
          </div>
          <p class="muted">${enabledCount}/${state.maxTrackedChannels} channels enabled</p>
        </div>
        <div class="actions top-actions">
          ${authActions}
          <button class="icon" data-action="open-options" aria-label="Options" title="Options" ${disabled}>&#9881;</button>
        </div>
      </div>

      ${
        state.auth
          ? ""
          : `<section class="section">
              <h2>Twitch setup</h2>
              <div class="uri-box">
                <div class="code-line">${escapeHtml(state.redirectUri)}</div>
                <button data-action="copy-redirect" ${disabled}>Copy</button>
              </div>
            </section>`
      }

      <section class="section">
        ${renderAddChannelForm(Boolean(state.auth) && !busy)}
      </section>

      ${flash ? `<div class="message ${flashIsError ? "error" : ""}" role="${flashIsError ? "alert" : "status"}">${escapeHtml(flash)}</div>` : ""}

      <section class="section">
        <div class="channel-list">
          ${
            state.channels.length
              ? state.channels.map(renderChannel).join("")
              : renderEmptyChannels(Boolean(state.auth))
          }
        </div>
      </section>
    </main>
  `;

  bindEvents();
}

function renderChannel(channel: PublicAppState["channels"][number]): string {
  const disabled = busy ? "disabled" : "";
  const sensitivityControl = channel.enabled
    ? `<label>
          Sensitivity
          <select data-channel-sensitivity ${disabled}>${sensitivityOptions(channel.sensitivity)}</select>
        </label>`
    : "";

  return `
    <article class="channel-row" style="${channelHeatStyle(channel.spikeScore)}" data-channel="${escapeHtml(channel.login)}">
      <div class="channel-head">
        ${renderChannelIdentity(channel)}
        <button class="icon danger channel-remove-button" data-channel-remove aria-label="Remove ${escapeHtml(channel.login)}" title="Remove" ${disabled}>&times;</button>
      </div>
      <div class="channel-meta">
        <span>Last alert</span>
        <strong>${formatTimeAgo(channel.lastNotificationAt)}</strong>
      </div>
      ${renderChannelMetrics(channel)}
      <div class="row-controls">
        ${renderToggleControl("Tracking", "data-channel-enabled", channel.enabled, busy)}
        ${renderToggleControl("Create clips", "data-channel-create-clips", channel.createClipsEnabled, busy)}
        ${sensitivityControl}
      </div>
      ${
        channel.errorMessage
          ? `<div class="message error">${escapeHtml(channel.errorMessage)}</div>`
          : ""
      }
    </article>
  `;
}

function bindLoadRetry(): void {
  app.querySelector<HTMLButtonElement>("[data-action='retry-load']")?.addEventListener(
    "click",
    () => {
      loadError = "";
      render();
      void refresh();
    }
  );
}

function bindEvents(): void {
  app.querySelector<HTMLButtonElement>("[data-action='connect']")?.addEventListener(
    "click",
    () => void openOptionsForConnect()
  );
  app.querySelector<HTMLButtonElement>("[data-action='disconnect']")?.addEventListener(
    "click",
    () => void run({ type: "DISCONNECT_TWITCH" })
  );
  app.querySelector<HTMLButtonElement>("[data-action='reconnect']")?.addEventListener(
    "click",
    () => void run({ type: "RECONNECT_EVENTSUB" })
  );
  app.querySelector<HTMLButtonElement>("[data-action='open-options']")?.addEventListener(
    "click",
    () => chrome.runtime.openOptionsPage()
  );
  app.querySelector<HTMLButtonElement>("[data-action='copy-redirect']")?.addEventListener(
    "click",
    () => void copyRedirectUri()
  );

  app.querySelector<HTMLFormElement>("[data-add-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const login = String(formData.get("login") ?? "");
    void run({ type: "ADD_CHANNEL", login }, () => form.reset());
  });

  app.querySelectorAll<HTMLElement>("[data-channel]").forEach((row) => {
    const login = row.dataset.channel ?? "";

    row.querySelector<HTMLInputElement>("[data-channel-enabled]")?.addEventListener(
      "change",
      (event) => {
        const input = event.currentTarget as HTMLInputElement;
        void run({
          type: "UPDATE_CHANNEL",
          login,
          patch: { enabled: input.checked }
        });
      }
    );

    row.querySelector<HTMLInputElement>("[data-channel-create-clips]")?.addEventListener(
      "change",
      (event) => {
        const input = event.currentTarget as HTMLInputElement;
        void run({
          type: "UPDATE_CHANNEL",
          login,
          patch: { createClipsEnabled: input.checked }
        });
      }
    );

    row.querySelector<HTMLSelectElement>("[data-channel-sensitivity]")?.addEventListener(
      "change",
      (event) => {
        const select = event.currentTarget as HTMLSelectElement;
        void run({
          type: "UPDATE_CHANNEL",
          login,
          patch: {
            sensitivity: select.value as SensitivityPresetName
          }
        });
      }
    );

    row.querySelector<HTMLButtonElement>("[data-channel-remove]")?.addEventListener(
      "click",
      () => {
        if (window.confirm(`Remove ${login} from tracked channels?`)) {
          void run({ type: "REMOVE_CHANNEL", login });
        }
      }
    );
  });
}

async function openOptionsForConnect(): Promise<void> {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("options.html#connect")
  });
}

async function copyRedirectUri(): Promise<void> {
  if (!state) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.redirectUri);
    flash = "Redirect URI copied.";
    flashIsError = false;
    render();
  } catch (error) {
    setFlash(error);
  }
}

async function run(
  command: Parameters<typeof sendCommand>[0],
  onSuccess?: () => void
): Promise<void> {
  if (busy) {
    return;
  }

  busy = true;
  flash = "";
  render();

  try {
    state = await sendCommand(command);
    onSuccess?.();
    render();
  } catch (error) {
    setFlash(error);
  } finally {
    busy = false;
    render();
  }
}

function setFlash(error: unknown): void {
  flash = error instanceof Error ? error.message : "Unexpected error.";
  flashIsError = true;
  render();
}
