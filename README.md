<p align="center">
  <img src="public/icons/icon128.png" alt="inb4 icon" width="96" height="96">
</p>

<h1 align="center">inb4</h1>

<p align="center">
  <strong>Catch your favorite Twitch moments.</strong>
</p>

`inb4` is a Chrome extension that watches the pace of Twitch chat and sends a desktop notification when conversation suddenly spikes. It learns each channel's normal activity, so alerts are based on unusual momentum instead of a single fixed message threshold.

## Highlights

- **Adaptive spike detection:** Compares recent chat activity with a rolling per-channel baseline.
- **Up to 10 channels:** Track several Twitch communities from one extension.
- **Adjustable sensitivity:** Choose a global sensitivity and override it per channel.
- **Desktop notifications:** Jump back when chat suggests something worth seeing is happening.
- **Optional clip creation:** With additional Twitch permission, create a clip when a spike is detected.
- **Live status:** View message rate, baseline activity, connection health, and the last alert in the popup.
- **Local-first storage:** Settings, tracked channels, and Twitch authorization data stay in Chrome's local extension storage.

## How it works

1. You connect a Twitch account and add channels to track.
2. `inb4` subscribes to Twitch chat events through EventSub.
3. The extension measures recent message velocity and builds a rolling baseline for each channel.
4. When activity rises far enough above that baseline, `inb4` sends a notification, subject to the configured cooldown.
5. If optional clip creation is enabled, the extension can request a Twitch clip alongside the alert.

The background process is designed for Chrome Manifest V3 and uses alarms to recover from service-worker suspension and EventSub interruptions.

## Install from source

### Requirements

- Chrome 120 or newer
- Node.js and npm
- A Twitch account
- Your own [registered Twitch developer application](https://dev.twitch.tv/docs/authentication/register-app)

### 1. Build the extension

Clone or download this repository, then run:

```bash
npm install
npm run build
```

The unpacked extension is generated in `dist/`.

### 2. Load it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project's `dist/` directory.
5. Open the extension's options page and copy the displayed Twitch redirect URI.

The redirect URI has this form:

```text
https://<extension-id>.chromiumapp.org/twitch
```

### 3. Configure your Twitch application

1. Register a Twitch application and add the exact redirect URI shown by `inb4` as an OAuth redirect URL.
2. Copy the application's Client ID.
3. Replace `TWITCH_CLIENT_ID` in `src/shared/constants.ts` with your Client ID.
4. Run `npm run build` again.
5. Return to `chrome://extensions` and reload `inb4`.

Twitch treats Client IDs as public identifiers, but each application should use its own. The Client ID in this repository belongs to the maintainer's application and will not authorize arbitrary unpacked-extension redirect URIs. This client-side extension does not need a Twitch client secret; never add one to the source code.

### 4. Connect and start tracking

Open the options page, select **Connect Twitch**, approve the requested access, and add the channel logins you want to monitor.

Chat tracking requests the `user:read:chat` scope. Automatic clip creation is disabled by default and requests `clips:edit` only if you choose to enable it.

## Permissions and privacy

`inb4` talks directly to Twitch and does not use a custom application server.

The extension requests these Chrome permissions:

| Permission | Why it is needed |
| --- | --- |
| `identity` | Complete Twitch OAuth through Chrome's extension redirect flow. |
| `notifications` | Show desktop alerts when a chat spike is detected. |
| `storage` | Store authorization, settings, tracked channels, and notification state locally. |
| `alarms` | Recover EventSub connections and perform scheduled clip-related work under Manifest V3. |

Host access is limited to Twitch authentication, API, image, and EventSub endpoints declared in `public/manifest.json`.

The locally stored Twitch access token is sensitive. You can disconnect Twitch or use **Clear local data** from the options page to remove extension data from the current Chrome profile.

Before a Chrome Web Store release, the project still needs appropriate store privacy disclosures and a published privacy policy covering the locally stored token, tracked-channel metadata, notifications, and optional clip creation.

## Development

```bash
# Rebuild into dist/ whenever source files change
npm run dev

# Type-check and create a production build
npm run build

# Run the unit test suite
npm test

# Run TypeScript checks only
npm run typecheck
```

The codebase uses TypeScript, Vite, Vitest, native DOM APIs, and Chrome extension APIs.

### CI and releases

GitHub Actions runs `npm run typecheck`, `npm test`, and `npm run build` for pull requests targeting `master` and for pushes to `master`.

Releases use [Release Please](https://github.com/googleapis/release-please-action) and Conventional Commit semantics:

- `fix:` proposes a PATCH release.
- `feat:` proposes a MINOR release.
- `<type>!:` or a `BREAKING CHANGE:` footer proposes a MAJOR release.

Release Please maintains a release pull request that synchronizes `package.json`, `package-lock.json`, `.release-please-manifest.json`, `public/manifest.json`, and this project's changelog. Merging that pull request creates a `vMAJOR.MINOR.PATCH` tag and GitHub Release. The release workflow builds the extension and attaches an `inb4-MAJOR.MINOR.PATCH.zip` containing the contents of `dist/`.

Chrome manifest versions must remain numeric. Prerelease labels and build metadata require a separate versioning scheme and are not currently supported by the automated release workflow. Publishing the ZIP to the Chrome Web Store remains a manual step.

### Project structure

```text
.github/workflows/ CI and Release Please automation
src/background/  Twitch, EventSub, alarms, clips, and notifications
src/shared/      Shared types, storage, validation, and spike calculations
src/popup/       Toolbar popup
src/options/     Options page
src/ui/          Shared UI rendering and styles
public/          Manifest and extension icons
```

Build output in `dist/` is generated and should not be edited by hand.

## License

No open-source license has been selected yet.

## Disclaimer

`inb4` is an independent project and is not affiliated with or endorsed by Twitch.
