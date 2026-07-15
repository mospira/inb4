import type { PublicAppState, SensitivityPresetName, Settings } from "../shared/types";
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
import { connectTwitch, hasClipEditScope } from "../background/twitchAuth";
import "../ui/styles.css";

const appElement = document.querySelector<HTMLDivElement>("#app");
let state: PublicAppState | null = null;
let busy = false;
let flash = "";
let flashIsError = false;
let loadError = "";
let autoConnectHandled = false;
let queuedSettingsPatch: Partial<Settings> | null = null;
let flushingSettings = false;

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
      ? renderLoadErrorShell("options-shell", loadError)
      : renderLoadingShell("options-shell");
    bindLoadRetry();
    return;
  }

  const controlsDisabled = busy || flushingSettings;
  const disabled = controlsDisabled ? "disabled" : "";
  app.innerHTML = `
    <main class="options-shell">
      <div class="topbar">
        <div class="brand">
          <div class="brand-title">
            <a class="brand-link" href="https://github.com/mospira/inb4" target="_blank" rel="noreferrer" aria-label="View inb4 on GitHub">
              <img class="mark options-mark" src="/icons/icon128.svg" alt="inb4">
            </a>
            ${renderConnectionStatusDot(state)}
          </div>
          <p class="muted">${state.auth ? `@${escapeHtml(state.auth.login)}` : "No Twitch account connected"}</p>
        </div>
        <div class="actions">
          ${
            state.auth
              ? `<button data-action="disconnect" ${disabled}>Disconnect</button><button data-action="reconnect" ${disabled}>Reconnect</button>`
              : `<button class="primary" data-action="connect" ${disabled}>Connect Twitch</button>`
          }
        </div>
      </div>

      ${flash ? `<div class="message ${flashIsError ? "error" : ""}" role="${flashIsError ? "alert" : "status"}">${escapeHtml(flash)}</div>` : ""}

      <section class="section">
        <div class="status-line">
          <span class="pill">${state.channels.length}/${state.maxTrackedChannels} saved</span>
          <span class="pill">${state.channels.filter((channel) => channel.enabled).length} enabled</span>
        </div>
      </section>

      <section class="section">
        <h2>Twitch setup</h2>
        <div class="uri-box">
          <div class="code-line">${escapeHtml(state.redirectUri)}</div>
          <button data-action="copy-redirect" ${disabled}>Copy</button>
        </div>
      </section>

      <section class="section">
        <h2>Settings</h2>
        <form class="setting-grid" data-settings-form>
          <label>
            Cooldown seconds
            <input name="defaultCooldownSeconds" type="number" min="60" step="30" value="${state.settings.defaultCooldownSeconds}" ${disabled} />
          </label>
          <label>
            Default sensitivity
            <select name="globalSensitivity" ${disabled}>${sensitivityOptions(state.settings.globalSensitivity)}</select>
          </label>
          <label class="checkbox-row">
            <input name="notificationsEnabled" type="checkbox" ${state.settings.notificationsEnabled ? "checked" : ""} ${disabled} />
            Notifications
          </label>
          ${renderToggleControl("Create clips by default", 'name="createClipsEnabled"', state.settings.createClipsEnabled, controlsDisabled)}
        </form>
      </section>

      <section class="section">
        <h2>Channels</h2>
        ${renderAddChannelForm(Boolean(state.auth) && !controlsDisabled)}
        <div class="channel-list">
          ${
            state.channels.length
              ? state.channels.map(renderChannel).join("")
              : renderEmptyChannels(Boolean(state.auth))
          }
        </div>
      </section>

      <div class="section">
        <div class="actions">
          <button class="danger" data-action="clear-data" ${disabled}>Clear local data</button>
        </div>
      </div>

      <footer class="options-footer">
        <a href="https://github.com/mospira" target="_blank" rel="noreferrer">github.com/mospira</a>
        <a href="https://github.com/mospira/inb4/blob/master/PRIVACY.md" target="_blank" rel="noreferrer">Privacy policy</a>
      </footer>
    </main>
  `;

  bindEvents();
  maybeAutoConnect();
}

function renderChannel(channel: PublicAppState["channels"][number]): string {
  const controlsDisabled = busy || flushingSettings;
  const disabled = controlsDisabled ? "disabled" : "";
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
        ${renderToggleControl("Tracking", "data-channel-enabled", channel.enabled, controlsDisabled)}
        ${renderToggleControl("Create clips", "data-channel-create-clips", channel.createClipsEnabled, controlsDisabled)}
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
    () => void runConnect()
  );
  app.querySelector<HTMLButtonElement>("[data-action='disconnect']")?.addEventListener(
    "click",
    () => void run({ type: "DISCONNECT_TWITCH" })
  );
  app.querySelector<HTMLButtonElement>("[data-action='reconnect']")?.addEventListener(
    "click",
    () => void run({ type: "RECONNECT_EVENTSUB" })
  );
  app.querySelector<HTMLButtonElement>("[data-action='copy-redirect']")?.addEventListener(
    "click",
    () => void copyRedirectUri()
  );
  app.querySelector<HTMLButtonElement>("[data-action='clear-data']")?.addEventListener(
    "click",
    () => {
      if (window.confirm("Clear all local inb4 data from this browser?")) {
        void run({ type: "CLEAR_DATA" });
      }
    }
  );

  const settingsForm = app.querySelector<HTMLFormElement>("[data-settings-form]");
  settingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings(event.currentTarget as HTMLFormElement);
  });
  settingsForm?.addEventListener("change", (event) => {
    void saveSettings(event.currentTarget as HTMLFormElement);
  });

  app.querySelector<HTMLFormElement>("[data-add-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    void run({ type: "ADD_CHANNEL", login: String(formData.get("login") ?? "") }, () =>
      form.reset()
    );
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

function maybeAutoConnect(): void {
  if (autoConnectHandled || window.location.hash !== "#connect" || !state) {
    return;
  }

  autoConnectHandled = true;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  if (!state.auth) {
    void runConnect();
  }
}

async function runConnect(
  includeClipScope = Boolean(
    state?.settings.createClipsEnabled ||
      state?.channels.some((channel) => channel.createClipsEnabled)
  )
): Promise<void> {
  if (busy) {
    return;
  }

  busy = true;
  flash = "Opening Twitch authorization...";
  flashIsError = false;
  render();

  try {
    const auth = await connectTwitch(includeClipScope);
    state = await sendCommand({ type: "COMPLETE_TWITCH_CONNECT", auth });
    flash = "";
    flashIsError = false;
  } catch (error) {
    flash = error instanceof Error ? error.message : "Unexpected error.";
    flashIsError = true;
  } finally {
    busy = false;
    render();
    void flushSettingsQueue();
  }
}

async function saveSettings(form: HTMLFormElement): Promise<void> {
  const formData = new FormData(form);
  const nextPatch: Partial<Settings> = {
    defaultCooldownSeconds: Number(formData.get("defaultCooldownSeconds")) || 600,
    globalSensitivity: formData.get("globalSensitivity") as SensitivityPresetName,
    notificationsEnabled: formData.has("notificationsEnabled"),
    createClipsEnabled: formData.has("createClipsEnabled")
  };

  if (
    nextPatch.createClipsEnabled &&
    state?.auth &&
    !hasClipEditScope(state.auth.scopes)
  ) {
    queuedSettingsPatch = nextPatch;

    if (
      window.confirm(
        "Automatic clips require Twitch clip permission. Reconnect Twitch now?"
      )
    ) {
      await runConnect(true);
      return;
    }

    queuedSettingsPatch = null;
    render();
    return;
  }

  queuedSettingsPatch = nextPatch;
  await flushSettingsQueue();
}

async function flushSettingsQueue(): Promise<void> {
  if (busy || flushingSettings) {
    return;
  }

  flushingSettings = true;
  render();
  try {
    while (queuedSettingsPatch) {
      const patch = queuedSettingsPatch;
      queuedSettingsPatch = null;
      const didSave = await run({
        type: "UPDATE_SETTINGS",
        patch
      });

      if (!didSave) {
        queuedSettingsPatch = patch;
        break;
      }
    }
  } finally {
    flushingSettings = false;
    render();
  }
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
): Promise<boolean> {
  if (busy) {
    return false;
  }

  busy = true;
  flash = "";
  render();

  try {
    state = await sendCommand(command);
    onSuccess?.();
    render();
    return true;
  } catch (error) {
    setFlash(error);
    return false;
  } finally {
    busy = false;
    void flushSettingsQueue();
    render();
  }
}

function setFlash(error: unknown): void {
  flash = error instanceof Error ? error.message : "Unexpected error.";
  flashIsError = true;
  render();
}
