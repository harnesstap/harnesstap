import { ulid } from "ulid";
import { getDb } from "../db/connection.js";

export type NotificationKind =
  | "update_available"
  | "auto_installed"
  | "check_failed"
  | "parent_published";

export interface NotificationRow {
  id: string;
  kind: NotificationKind | string;
  title: string;
  body: string;
  plugin_name: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

interface StoredRow extends Omit<NotificationRow, "payload"> {
  payload: string;
}

function decode(row: StoredRow): NotificationRow {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { ...row, payload };
}

/**
 * Write one notification. The same (kind, plugin, payload.version) is
 * written once: a repeat is ignored and returns null.
 */
export function addNotification(input: {
  kind: NotificationKind;
  title: string;
  body?: string;
  plugin_name?: string;
  payload?: Record<string, unknown>;
  now?: Date;
}): NotificationRow | null {
  const row: StoredRow = {
    id: ulid(),
    kind: input.kind,
    title: input.title,
    body: input.body ?? "",
    plugin_name: input.plugin_name ?? "",
    payload: JSON.stringify(input.payload ?? {}),
    created_at: (input.now ?? new Date()).toISOString(),
    read_at: null,
  };
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, kind, title, body, plugin_name, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.kind, row.title, row.body, row.plugin_name, row.payload, row.created_at);
  return result.changes > 0 ? decode(row) : null;
}

/** Producers never break the work that produced them. */
export function notifySafely(input: Parameters<typeof addNotification>[0]): NotificationRow | null {
  try {
    return addNotification(input);
  } catch {
    return null;
  }
}

export function listNotifications(opts?: { filter?: "unread" | "all"; limit?: number }): NotificationRow[] {
  const filter = opts?.filter ?? "unread";
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const where = filter === "unread" ? "WHERE read_at IS NULL" : "";
  return (
    getDb()
      .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(limit) as StoredRow[]
  ).map(decode);
}

/** Cheap enough for every status call: one indexed count, empty table on any error. */
export function unreadNotificationCount(): number {
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL").get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export function getNotification(id: string): NotificationRow | null {
  const row = getDb().prepare("SELECT * FROM notifications WHERE id = ?").get(id) as StoredRow | undefined;
  return row ? decode(row) : null;
}

/** Mark one as read. Returns null when the id does not exist; already read stays as it was. */
export function markNotificationRead(id: string, now: Date = new Date()): NotificationRow | null {
  getDb().prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL").run(now.toISOString(), id);
  return getNotification(id);
}

export function markAllNotificationsRead(now: Date = new Date()): number {
  return getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL")
    .run(now.toISOString()).changes;
}

/** Read notifications older than the cutoff. Unread ones are never pruned. */
export function listPrunableNotifications(olderThanMs: number, now: Date = new Date()): NotificationRow[] {
  const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
  return (
    getDb()
      .prepare("SELECT * FROM notifications WHERE read_at IS NOT NULL AND created_at < ? ORDER BY created_at")
      .all(cutoff) as StoredRow[]
  ).map(decode);
}

/** Deletes only the rows listed by listPrunableNotifications. Called only by an explicit prune. */
export function pruneNotifications(olderThanMs: number, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
  return getDb()
    .prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?")
    .run(cutoff).changes;
}

/** "90d", "12h", "2w". */
export function parseAge(value: string): number | null {
  const match = /^(\d+)\s*([hdw])$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "d").toLowerCase();
  const hour = 60 * 60 * 1000;
  return amount * (unit === "h" ? hour : unit === "d" ? 24 * hour : 7 * 24 * hour);
}
