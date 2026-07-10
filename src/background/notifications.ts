import { normalizeLogin } from "../shared/login";
import { CLIP_NOTIFICATION_DELAY_MS } from "../shared/constants";

const NOTIFICATION_ICON_URL = "icons/icon128.png";

export async function createSpikeNotification(
  login: string,
  hasClip: boolean
): Promise<string> {
  if (hasClip) {
    await wait(CLIP_NOTIFICATION_DELAY_MS);
  }

  const id = `inb4:${login}:${Date.now()}`;
  return chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON_URL),
    title: `inb4: ${login}`,
    message: hasClip
      ? "Something exciting is happening! Click here to see a clip."
      : "Something exciting is happening!",
    priority: 1
  });
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function parseNotificationLogin(notificationId: string): string | null {
  const [, login] = notificationId.split(":");
  return login ? normalizeLogin(login) : null;
}
