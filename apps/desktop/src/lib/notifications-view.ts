import type { NotificationFilter, NotificationItem } from "./api/notifications";
import { formatRelativeTime } from "./library-timestamp";

export const NOTIFICATION_TABS: { id: NotificationFilter; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
];

/** Badge text: nothing at zero, "99+" past 99. */
export function unreadBadgeText(count: number | undefined): string {
  if (!count || count < 1) return "";
  return count > 99 ? "99+" : String(count);
}

export function bellLabel(count: number | undefined): string {
  if (!count || count < 1) return "Notifications";
  return `Notifications (${count} unread)`;
}

export function emptyNotificationsText(filter: NotificationFilter): string {
  return filter === "unread" ? "All caught up." : "No notifications yet.";
}

export function notificationTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatRelativeTime(date, now);
}

/** Apply a mark-read locally, so the list does not wait for a refetch. */
export function withRead(
  items: NotificationItem[],
  filter: NotificationFilter,
  ids: Set<string> | "all",
  at: string,
): NotificationItem[] {
  const hit = (item: NotificationItem) => ids === "all" || ids.has(item.id);
  if (filter === "unread") return items.filter((item) => !hit(item));
  return items.map((item) => (hit(item) && !item.read_at ? { ...item, read_at: at } : item));
}

/** Update notifications carry the version; reading one clears the rail badge for it. */
export function seenKeysFor(items: readonly NotificationItem[]): string[] {
  return items.flatMap((item) => {
    const version = item.payload?.version;
    if (typeof version !== "string" || !version) return [];
    if (item.kind !== "update_available" && item.kind !== "parent_published") return [];
    return [`${item.plugin_name}@${version}`];
  });
}
