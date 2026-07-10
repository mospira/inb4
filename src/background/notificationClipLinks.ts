export interface NotificationClipLink {
  url: string;
  expiresAt: number;
}

export type NotificationClipLinkStore = Record<string, NotificationClipLink>;

export const NOTIFICATION_CLIP_LINK_TTL_MS = 24 * 60 * 60_000;

export function createNotificationClipLink(
  url: string,
  now = Date.now()
): NotificationClipLink {
  return {
    url,
    expiresAt: now + NOTIFICATION_CLIP_LINK_TTL_MS
  };
}

export function pruneNotificationClipLinks(
  links: NotificationClipLinkStore,
  now = Date.now()
): NotificationClipLinkStore {
  return Object.fromEntries(
    Object.entries(links).filter(([, link]) => link.expiresAt > now)
  );
}

export function readNotificationClipUrl(
  links: NotificationClipLinkStore,
  notificationId: string,
  now = Date.now()
): string | null {
  const link = links[notificationId];
  return link && link.expiresAt > now ? link.url : null;
}
