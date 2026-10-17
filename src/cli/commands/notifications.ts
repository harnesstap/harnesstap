import type { Command } from "commander";

type ListOpts = { all?: boolean; limit?: string; format?: string };

/** `--all` after a subcommand can land on the group; read it from both. */
function merged<T extends object>(command: Command): T {
  return command.optsWithGlobals<T>();
}
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  handleNotificationsListCommand,
  handleNotificationsPruneCommand,
  handleNotificationsReadCommand,
} from "../handlers/notifications.js";
import { renderCliError } from "../runtime.js";

async function run(work: () => void | Promise<void>): Promise<void> {
  try {
    initializeSchema(getDb());
    await work();
  } catch (error) {
    process.exitCode = 1;
    renderCliError(error);
  }
}

export function registerNotificationsCommands(root: Command): void {
  const cmd = root
    .command("notifications")
    .description("List plugin update notifications (unread by default)")
    .option("-a, --all", "Include read notifications")
    .option("--limit <n>", "Most recent notifications to show", "50")
    .option("--format <mode>", "Output format: human or json", "human")
    .helpCommand(false)
    .action((_opts: ListOpts, command: Command) => run(() => handleNotificationsListCommand(merged<ListOpts>(command))));

  cmd
    .command("list")
    .option("-a, --all", "Include read notifications")
    .option("--limit <n>", "Most recent notifications to show")
    .option("--format <mode>", "Output format: human or json")
    .description("List plugin update notifications (unread by default); same as ht notifications")
    .action((_opts: ListOpts, command: Command) => run(() => handleNotificationsListCommand(merged<ListOpts>(command))));

  cmd
    .command("read")
    .argument("[id]", "Notification id")
    .option("-a, --all", "Mark every notification as read")
    .option("--format <mode>", "Output format: human or json")
    .description("Mark a notification, or all of them, as read")
    .action((id: string | undefined, _opts: ListOpts, command: Command) =>
      run(() => handleNotificationsReadCommand(id, merged<ListOpts>(command))));

  cmd
    .command("prune")
    .requiredOption("--older-than <age>", "Age such as 12h, 90d or 2w")
    .option("-y, --yes", "Delete without asking")
    .option("--format <mode>", "Output format: human or json")
    .description("Delete read notifications older than an age, after confirmation")
    .action((_opts: unknown, command: Command) =>
      run(() => handleNotificationsPruneCommand(merged<{ olderThan?: string; yes?: boolean; format?: string }>(command))));
}
