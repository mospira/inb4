# Privacy Policy for inb4

**Effective date:** July 14, 2026

`inb4` is a Chrome extension that monitors message activity in Twitch channels selected by the user and sends a notification when chat velocity spikes. This policy explains what data the extension handles, why it is used, where it is stored, and when it is shared.

## Summary

- `inb4` does not use a developer-operated server.
- The extension communicates directly with Twitch to authenticate the user, receive chat events, look up channel and clip information, and optionally create clips.
- Extension settings, authorization data, and tracked-channel metadata are stored locally in the user's Chrome profile.
- Twitch chat message text is not used or stored. Event timestamps, message identifiers, and chatter identifiers are processed to detect spikes and duplicate events.
- User data is not sold, used for advertising, or used for creditworthiness or lending decisions.

## Data the extension handles

### Twitch account and authentication data

When a user connects Twitch, the extension receives and locally stores:

- the Twitch OAuth access token;
- the user's Twitch login and user ID;
- the permissions granted to the token;
- token-expiration and connection timestamps.

This data is used only to authenticate Twitch API requests, validate the connection, subscribe to chat events, and provide features the user enables. The access token is not exposed in the extension's public interface or sent to the developer.

### Tracked channels and preferences

The extension stores channel logins selected by the user and channel metadata returned by Twitch, including broadcaster IDs, display names, and profile-image URLs. It also stores notification, sensitivity, cooldown, and optional clip-creation preferences, plus limited status and notification state needed to operate those features.

### Twitch chat events

Twitch sends EventSub chat events for enabled tracked channels. These events can contain a message timestamp, message ID, broadcaster identifiers, chatter identifiers and login, and message text.

`inb4` uses timestamps and identifiers to count messages, reject duplicate events, and measure distinct participation. It does not use or store message text. Raw chatter identifiers are held only temporarily in service-worker memory for live spike detection, for no more than the rolling six-minute detector window, and are not written to persistent or session detector storage.

Compact detector checkpoints in Chrome session storage contain aggregate bucket counts, coverage state, channel logins, and hashed message-deduplication tokens so detection can recover from ordinary service-worker suspension. They do not contain raw chatter identifiers, chat logins, or message text.

### Clips and notifications

The extension queries Twitch for stream and recent-clip information needed to confirm alerts. If the user separately enables clip creation and grants the `clips:edit` permission, the extension can ask Twitch to create a clip for the selected broadcaster. Notification IDs and associated Twitch clip URLs may be stored locally for up to 24 hours so clicking a notification opens the correct clip; they are removed sooner when the notification is clicked or closed.

## How data is collected

Data is received through:

- information and settings the user enters in the extension;
- Twitch OAuth, Helix API, and EventSub responses; and
- Chrome extension APIs used for local storage, session recovery, alarms, and notifications.

The extension does not collect browsing history, page contents from sites the user visits, precise location, health information, financial information, or payment information.

## How data is used

The extension uses data only to:

- connect and validate the user's Twitch account;
- resolve and manage user-selected Twitch channels;
- maintain Twitch EventSub chat subscriptions;
- calculate aggregate chat velocity and distinct participation;
- send spike notifications and open associated Twitch clips;
- create clips when the user explicitly enables that feature; and
- retain settings and recover extension operation after service-worker suspension.

## Data sharing

`inb4` does not sell user data and does not share it with advertisers, data brokers, analytics providers, or the developer.

Data is shared or processed only by the following parties as necessary to provide the extension's single purpose:

- **Twitch Interactive, Inc.** The extension sends the OAuth token, Twitch user and broadcaster identifiers, EventSub subscription requests, and optional clip-creation requests directly to Twitch. Twitch returns account, channel, chat-event, stream, and clip data. Twitch handles that data under the [Twitch Privacy Notice](https://legal.twitch.com/en/legal/privacy-notice/).
- **Google Chrome and the user's operating system.** Chrome stores extension data in the user's local browser profile and delivers extension requests such as alarms and notifications. The operating system may display those notifications. This processing is performed by the user's browser and device; the data is not sent to a developer-operated service.

The extension may disclose information if required by applicable law. Because the developer does not operate a data-collection server, the developer ordinarily has no access to extension data stored in a user's Chrome profile.

## Storage, retention, and deletion

Authentication data, settings, tracked channels, and necessary notification state remain in Chrome's local extension storage until the user removes them or uninstalls the extension. Detector recovery state is kept in Chrome session storage and is cleared when local data is cleared.

Users can:

- disconnect Twitch to remove the locally stored OAuth token;
- remove individual tracked channels;
- use **Clear local data** in the options page to remove the extension's locally stored and session data;
- revoke the extension's Twitch authorization through Twitch account settings; or
- uninstall the extension to remove its extension storage from Chrome.

## Security

Communications with Twitch use encrypted HTTPS or WSS connections. The extension limits Chrome host permissions to Twitch authentication and API services, does not execute remotely hosted code, and keeps the OAuth token out of logs, notifications, and public UI state. No method of storage or transmission can be guaranteed completely secure.

## Limited Use

`inb4`'s use of information is limited to providing and improving its disclosed single purpose and user-facing features. User data is not used or transferred for personalized advertising, unrelated purposes, or creditworthiness or lending decisions. Human access to user data is not permitted except with the user's affirmative consent for support, when necessary for security, or when required by law.

`inb4` complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Changes to this policy

This policy may be updated when the extension's data practices or legal obligations change. The effective date above will be updated when a revision is published. Material changes to data practices will also be disclosed as required by Chrome Web Store policy.

## Contact

Questions about this policy can be submitted through the [inb4 GitHub issue tracker](https://github.com/mospira/inb4/issues). Do not include OAuth tokens, credentials, chat messages, or other sensitive information in a public issue.
