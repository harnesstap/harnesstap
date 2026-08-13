import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import { parseResourceSelector } from "../../services/resource-selector.js";
import type { ProfileApplyPreviewScope } from "../../services/profile-apply-preview.js";
import {
  commitManagedPathFromLive,
  commitManagedResourceFromLive,
} from "../../services/profile-commit-resource.js";
import { getManagedFileDiff } from "../../services/profile-file-diff.js";
import { removeResourceFromProfile } from "../../services/profile-remove-resource.js";
import { restoreManagedFile } from "../../services/profile-restore-file.js";
import {
  addAllUntrackedResourcesToProfile,
  addResourceToProfile,
} from "../../services/profile-untracked-resources.js";
import {
  promptForConfirmation,
  shouldUseBrowsePicker,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { buildUnifiedDiffLines } from "../../utils/unified-diff.js";

export interface LiveScopeOpts {
  scope?: string;
  project?: string;
  harness?: string;
  format?: string;
  interactive?: boolean;
  noInteractive?: boolean;
}

export interface ConfirmOpts {
  yes?: boolean;
  format?: string;
  noInteractive?: boolean;
}

function initDb(): void {
  const db = getDb();
  initializeSchema(db);
}

function requireTypeNameSelector(
  raw: string | undefined,
  commandPath: string,
): { type: string; name: string } {
  if (!raw) {
    throw missingRequiredArg("selector", commandPath);
  }
  const parsed = parseResourceSelector(raw);
  if (!parsed.type || parsed.name.trim().length === 0) {
    throw missingRequiredArg("selector", commandPath);
  }
  return { type: parsed.type, name: parsed.name };
}

function requireLiveScope(
  opts: LiveScopeOpts,
  commandPath: string,
): {
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
} {
  if (opts.scope !== "home" && opts.scope !== "project") {
    throw missingRequiredArg("scope", commandPath);
  }
  const harness = opts.harness?.trim();
  if (opts.scope === "project") {
    const projectPath = opts.project?.trim();
    if (!projectPath) {
      throw missingRequiredArg("project", commandPath);
    }
    return {
      scope: opts.scope,
      projectPath,
      ...(harness ? { harness } : {}),
    };
  }
  return {
    scope: opts.scope,
    ...(harness ? { harness } : {}),
  };
}

async function confirmOrRefuse(input: {
  message: string;
  yes?: boolean;
  format?: string;
  noInteractive?: boolean;
}): Promise<"proceed" | "cancelled" | "refused"> {
  if (input.yes) {
    return "proceed";
  }
  if (shouldUseBrowsePicker({
    noInteractive: input.noInteractive,
    format: input.format,
  })) {
    const confirmed = await promptForConfirmation({
      message: input.message,
      default: false,
    });
    if (!confirmed) {
      ui.info("Operation cancelled.");
      return "cancelled";
    }
    return "proceed";
  }
  process.exitCode = 1;
  ui.hint("Pass -y to confirm.");
  return "refused";
}

export async function handleProfileAddResourceCommand(
  name: string,
  opts: LiveScopeOpts & { selector?: string },
): Promise<void> {
  initDb();
  const format = parseOutputFormat(opts.format);
  const selector = requireTypeNameSelector(opts.selector, "profile add-resource");
  const scope = requireLiveScope(opts, "profile add-resource");
  const resource = await addResourceToProfile({
    profileSelector: name,
    resourceType: selector.type,
    resourceName: selector.name,
    ...scope,
  });
  if (format === "json") {
    printJson({ resource });
    return;
  }
  ui.success(`Added ${selector.type}:${selector.name} to profile ${name}.`);
}

export async function handleProfileAddAllResourcesCommand(
  name: string,
  opts: LiveScopeOpts,
): Promise<void> {
  initDb();
  const format = parseOutputFormat(opts.format);
  const scope = requireLiveScope(opts, "profile add-all-resources");
  const result = await addAllUntrackedResourcesToProfile({
    profileSelector: name,
    ...scope,
  });
  if (format === "json") {
    printJson(result);
    return;
  }
  const noun = result.added_count === 1 ? "resource" : "resources";
  ui.success(`Added ${result.added_count} ${noun} to profile ${name}.`);
}

export async function handleProfileCommitResourceCommand(
  name: string,
  opts: LiveScopeOpts & { path?: string; selector?: string },
): Promise<void> {
  initDb();
  const format = parseOutputFormat(opts.format);
  const scope = requireLiveScope(opts, "profile commit-resource");
  const path = opts.path?.trim() ?? "";
  const hasSelector = Boolean(opts.selector?.trim());
  if (!path && !hasSelector) {
    throw missingRequiredArg("path", "profile commit-resource");
  }

  if (path && !hasSelector) {
    const resources = await commitManagedPathFromLive({
      profileSelector: name,
      path,
      ...scope,
    });
    if (format === "json") {
      printJson({ resource: resources[0] ?? null, resources });
      return;
    }
    ui.success(`Committed ${path} into profile ${name}.`);
    return;
  }

  const selector = requireTypeNameSelector(opts.selector, "profile commit-resource");
  if (path) {
    const resources = await commitManagedPathFromLive({
      profileSelector: name,
      path,
      resourceType: selector.type,
      resourceName: selector.name,
      ...scope,
    });
    if (format === "json") {
      printJson({ resource: resources[0] ?? null, resources });
      return;
    }
    ui.success(`Committed ${path} into profile ${name}.`);
    return;
  }

  const resource = await commitManagedResourceFromLive({
    profileSelector: name,
    resourceType: selector.type,
    resourceName: selector.name,
    ...scope,
  });
  if (format === "json") {
    printJson({ resource });
    return;
  }
  ui.success(`Committed ${selector.type}:${selector.name} into profile ${name}.`);
}

export async function handleProfileRemoveResourceCommand(
  name: string,
  opts: ConfirmOpts & { selector?: string; pluginId?: string },
): Promise<void> {
  initDb();
  const format = parseOutputFormat(opts.format);
  const selector = requireTypeNameSelector(opts.selector, "profile remove-resource");
  const gate = await confirmOrRefuse({
    message: `Remove ${selector.type}:${selector.name} from profile ${name}?`,
    yes: opts.yes,
    format: opts.format,
    noInteractive: opts.noInteractive,
  });
  if (gate !== "proceed") {
    return;
  }
  const resource = removeResourceFromProfile({
    profileSelector: name,
    resourceType: selector.type,
    resourceName: selector.name,
    ...(opts.pluginId?.trim() ? { pluginId: opts.pluginId.trim() } : {}),
  });
  if (format === "json") {
    printJson({ resource });
    return;
  }
  ui.success(`Removed ${selector.type}:${selector.name} from profile ${name}.`);
}

export async function handleProfileRestoreFileCommand(
  name: string,
  opts: LiveScopeOpts & ConfirmOpts & { path?: string },
): Promise<void> {
  initDb();
  const format = parseOutputFormat(opts.format);
  const scope = requireLiveScope(opts, "profile restore-file");
  const path = opts.path?.trim() ?? "";
  if (!path) {
    throw missingRequiredArg("path", "profile restore-file");
  }
  const gate = await confirmOrRefuse({
    message:
      `Overwrite ${path} with the profile version? Live edits cannot be restored.`,
    yes: opts.yes,
    format: opts.format,
    noInteractive: opts.noInteractive,
  });
  if (gate !== "proceed") {
    return;
  }
  const result = await restoreManagedFile({
    profileSelector: name,
    path,
    ...scope,
  });
  if (format === "json") {
    printJson(result);
    return;
  }
  ui.success(`Restored ${result.path}.`);
}

export async function handleProfileFileDiffCommand(
  name: string,
  opts: LiveScopeOpts & { path?: string },
): Promise<void> {
  initDb();
  const format = parseOutputFormat(opts.format);
  const scope = requireLiveScope(opts, "profile file-diff");
  const path = opts.path?.trim() ?? "";
  if (!path) {
    throw missingRequiredArg("path", "profile file-diff");
  }
  const diff = await getManagedFileDiff({
    profileSelector: name,
    path,
    ...scope,
  });
  if (format === "json") {
    printJson({
      path: diff.path,
      absolute_path: diff.absolute_path,
      expected: diff.expected,
      current: diff.current,
    });
    return;
  }
  const lines = buildUnifiedDiffLines(diff.path, diff.expected, diff.current);
  console.log(lines.map((line) => line.text).join("\n"));
}
