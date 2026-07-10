import { createSpikeNotification } from "./notifications";
import { getClipPageUrl } from "./twitchApi";
import type { CreatedClip } from "./twitchApi";

interface NotifySpikeOptions {
  login: string;
  createClip?: () => Promise<CreatedClip | null>;
  createNotification?: (login: string, hasClip: boolean) => Promise<string>;
  getClipUrl?: (clipId: string) => string;
}

export interface NotifySpikeResult {
  notificationId: string;
  clipUrl?: string;
}

export async function notifySpikeWithOptionalClip({
  login,
  createClip,
  createNotification = createSpikeNotification,
  getClipUrl = getClipPageUrl
}: NotifySpikeOptions): Promise<NotifySpikeResult> {
  let clip: CreatedClip | null = null;

  if (createClip) {
    try {
      clip = await createClip();
    } catch {
      clip = null;
    }
  }

  const notificationId = await createNotification(login, Boolean(clip));

  return {
    notificationId,
    ...(clip ? { clipUrl: getClipUrl(clip.id) } : {})
  };
}
