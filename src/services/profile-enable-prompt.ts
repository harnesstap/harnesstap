import { ui } from "../ui/index.js";
import { detectGlobalProfileStatus } from "./global-profile-drift.js";
import { useProfileCommand } from "./profile-commands.js";
import { maybeSyncActiveProfileBeforeSwitch } from "./profile-switch-prompt.js";
import { promptForConfirmation } from "./wizards/shared.js";
import { promptMaterializationConflict, resolveApplyConflictPolicy } from "./materialization-conflicts.js";

export function shouldPromptProfileEnable(input: {
  yes?: boolean;
  format?: string;
}): boolean {
  if (input.yes || input.format === "json") {
    return false;
  }
  if (
    process.argv.includes("--no-interactive")
    || process.env.HARNESSTAP_NO_INTERACTIVE === "1"
  ) {
    return false;
  }

  const ciValue = process.env.CI?.trim().toLowerCase();
  const ciEnabled = Boolean(
    ciValue && ciValue !== "0" && ciValue !== "false" && ciValue !== "no",
  );
  if (ciEnabled) {
    return false;
  }

  return Boolean(
    process.env.HARNESSTAP_FORCE_WIZARD === "1"
      || (process.stdin.isTTY && process.stdout.isTTY),
  );
}

export async function maybePromptProfileEnable(input: {
  profileName: string;
  format?: string;
  yes?: boolean;
  harness?: string;
  pull?: boolean;
  account?: string;
  baseUrl?: string;
  onConflictUse?: string;
}): Promise<void> {
  const format = input.format ?? "human";
  if (format !== "human") {
    return;
  }

  const status = await detectGlobalProfileStatus({ harness: input.harness });
  if (status.active_profile === input.profileName && !status.has_drift) {
    ui.success(
      `Profile ${ui.theme.accent(input.profileName)} is already active and in sync globally.`,
    );
    return;
  }

  if (!shouldPromptProfileEnable({ yes: input.yes, format })) {
    if (status.active_profile === input.profileName) {
      ui.hint(`Run harnesstap profile use ${input.profileName} to apply globally.`);
      return;
    }
    ui.hint(
      `Switch to it with harnesstap profile use ${input.profileName} or ht ${input.profileName}`,
    );
    return;
  }

  const message = status.active_profile === input.profileName
    ? `Apply profile ${input.profileName} to your global harness files now?`
    : `Enable profile ${input.profileName} globally and set it as active?`;

  const confirmed = await promptForConfirmation({
    message,
    default: true,
  });

  if (!confirmed) {
    ui.hint(
      `Switch later with harnesstap profile use ${input.profileName} or ht ${input.profileName}`,
    );
    return;
  }

  if (
    status.active_profile
    && status.active_profile !== input.profileName
  ) {
    await maybeSyncActiveProfileBeforeSwitch({
      targetProfileName: input.profileName,
      harness: input.harness,
      yes: input.yes,
      format,
    });
  }

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: input.onConflictUse,
  });
  const applied = await useProfileCommand(input.profileName, {
    harness: input.harness,
    pull: input.pull,
    account: input.account,
    baseUrl: input.baseUrl,
    conflictPolicy,
    ...(conflictPolicy === "prompt"
      ? { conflictResolver: promptMaterializationConflict }
      : {}),
  });

  if (applied.cancelled) {
    ui.warn("Profile apply cancelled.");
    return;
  }

  ui.success(
    `Applied profile ${ui.theme.accent(applied.profile_name)} to ${applied.harnesses.join(", ") || "(none)"}`,
  );
}
