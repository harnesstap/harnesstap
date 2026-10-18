import {
  getNotification,
  listNotifications,
  listPrunableNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  parseAge,
  pruneNotifications,
  unreadNotificationCount,
  type NotificationRow,
} from "../../services/notifications.js";
import {
  isPromptCancellationError,
  promptForChoice,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { formatCount } from "../formatting.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { canPromptInteractively } from "./plugin-auto-update.js";

export class NotificationsUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationsUsageError";
  }
}

function localTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function printRow(row: NotificationRow): void {
  const marker = row.read_at ? " " : "*";
  console.log(`${marker} ${row.id}  ${localTime(row.created_at)}  ${row.title}`);
  if (row.body) console.log(`  ${row.body}`);
}

export function handleNotificationsListCommand(opts: { all?: boolean; limit?: string; format?: string }): void {
  const format = parseOutputFormat(opts.format);
  const limit = opts.limit === undefined ? 50 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new NotificationsUsageError("--limit must be a positive number.");
  const items = listNotifications({ filter: opts.all ? "all" : "unread", limit });
  const unread = unreadNotificationCount();
  if (format === "json") {
    printJson({ items, unread_count: unread });
    return;
  }
  if (items.length === 0) {
    ui.info(opts.all ? "No notifications." : "No unread notifications.");
    return;
  }
  for (const row of items) printRow(row);
  console.log("");
  ui.info(`${formatCount(unread, "unread notification")}. Mark as read with ht notifications read <id> or --all.`);
}

export function handleNotificationsReadCommand(id: string | undefined, opts: { all?: boolean; format?: string }): void {
  const format = parseOutputFormat(opts.format);
  if (opts.all && id) throw new NotificationsUsageError("Pass a notification id or --all, not both.");
  if (!opts.all && !id) throw new NotificationsUsageError("Pass a notification id, or --all to mark every one as read.");
  if (opts.all) {
    const marked = markAllNotificationsRead();
    if (format === "json") printJson({ marked, unread_count: 0 });
    else ui.success(`Marked ${formatCount(marked, "notification")} as read.`);
    return;
  }
  if (!getNotification(id!)) throw new NotificationsUsageError(`No notification ${id}.`);
  const row = markNotificationRead(id!);
  if (format === "json") printJson({ item: row, unread_count: unreadNotificationCount() });
  else ui.success(`Marked ${id} as read.`);
}

export interface PruneDeps {
  interactive: boolean;
  choose: typeof promptForChoice;
}

/**
 * Deletes read notifications older than the given age. Nothing is deleted
 * without --yes or an explicit answer in an interactive terminal; unread
 * notifications are never pruned.
 */
export async function handleNotificationsPruneCommand(
  opts: { olderThan?: string; yes?: boolean; format?: string },
  deps: PruneDeps = { interactive: canPromptInteractively(), choose: promptForChoice },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  if (!opts.olderThan) throw new NotificationsUsageError("Pass --older-than, for example --older-than 90d.");
  const age = parseAge(opts.olderThan);
  if (age === null) throw new NotificationsUsageError(`--older-than takes hours, days or weeks, such as 12h, 90d or 2w; got ${opts.olderThan}.`);
  const candidates = listPrunableNotifications(age);
  if (candidates.length === 0) {
    if (format === "json") printJson({ deleted: 0 });
    else ui.info(`No read notifications older than ${opts.olderThan}.`);
    return;
  }
  if (!opts.yes) {
    if (!deps.interactive) {
      throw new NotificationsUsageError(
        `This deletes ${formatCount(candidates.length, "read notification")} older than ${opts.olderThan}. Pass --yes to confirm.`,
      );
    }
    let answer: "delete" | "cancel";
    try {
      answer = await deps.choose<"delete" | "cancel">({
        message: `Delete ${formatCount(candidates.length, "read notification")} older than ${opts.olderThan}?`,
        default: "cancel",
        choices: [
          { name: "Cancel", value: "cancel" },
          { name: "Delete", value: "delete" },
        ],
      });
    } catch (error) {
      if (!isPromptCancellationError(error)) throw error;
      answer = "cancel";
    }
    if (answer !== "delete") {
      ui.info("Nothing deleted.");
      return;
    }
  }
  const deleted = pruneNotifications(age);
  if (format === "json") printJson({ deleted });
  else ui.success(`Deleted ${formatCount(deleted, "read notification")} older than ${opts.olderThan}.`);
}
