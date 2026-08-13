import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getActiveProfileName } from "../../services/active-profile.js";
import { CliUsageError, missingRequiredArg } from "../../services/cli-errors.js";
import { COMMAND_HELP_REGISTRY } from "../../services/cli-help-registry.js";
import {
  type ProfileApplyPreview,
  type ProfileApplyPreviewScope,
  previewProfileApply,
} from "../../services/profile-apply-preview.js";
import { isPromptCancellationError } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { resolvePluginMutationTarget } from "../handlers/resolve-plugin-mutation-target.js";
import { renderCliError } from "../runtime.js";

const CLI_PREVIEW_SCOPES = ["home", "project", "both"] as const;
type CliPreviewScope = (typeof CLI_PREVIEW_SCOPES)[number];

const PROFILE_PREVIEW_HELP = {
  description:
    "Show apply preview for a profile (contents, files, untracked, recovery) without writing",
  examples: [
    "profile preview",
    "profile preview work --format json",
    "profile preview work --scope project --project .",
    "profile preview work --scope both",
  ],
} as const;

function isCliPreviewScope(value: string): value is CliPreviewScope {
  return (CLI_PREVIEW_SCOPES as readonly string[]).includes(value);
}

function parseCliPreviewScope(value: string | undefined): CliPreviewScope {
  const scope = value ?? "home";
  if (!isCliPreviewScope(scope)) {
    throw new CliUsageError(
      `Invalid --scope value: ${scope}. Use home, project, or both.`,
    );
  }
  return scope;
}

function resolveProjectPathForScope(
  scope: CliPreviewScope,
  project: string | undefined,
): string | undefined {
  if (scope === "home") {
    return undefined;
  }
  const projectPath = (project ?? ".").trim();
  if (!projectPath) {
    throw new CliUsageError("projectPath is required for project scope");
  }
  return projectPath;
}

async function resolvePreviewProfileName(input: {
  name: string | undefined;
  format?: string;
  interactive?: boolean;
  noInteractive?: boolean;
}): Promise<string | undefined> {
  const trimmed = input.name?.trim();
  if (trimmed) {
    return trimmed;
  }
  const active = getActiveProfileName();
  if (active) {
    return active;
  }
  return resolvePluginMutationTarget({
    pluginName: undefined,
    profileMode: true,
    interactive: input.interactive,
    noInteractive: input.noInteractive,
    format: input.format,
    message: "Which profile do you want to preview?",
  });
}

function engineScopes(scope: CliPreviewScope): ProfileApplyPreviewScope[] {
  switch (scope) {
    case "home":
      return ["home"];
    case "project":
      return ["project"];
    case "both":
      return ["home", "project"];
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

async function loadPreview(input: {
  profile: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ProfileApplyPreview> {
  return previewProfileApply({
    profile: input.profile,
    scope: input.scope,
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.harness ? { harness: input.harness } : {}),
  });
}

function printInstallGaps(preview: ProfileApplyPreview): void {
  if (preview.scope !== "home" || !preview.harnesses) {
    return;
  }
  for (const status of Object.values(preview.harnesses)) {
    for (const plugin of status.plugins) {
      if (plugin.state === "missing") {
        ui.dim(`plugin ${plugin.id} not installed`);
      }
    }
    for (const mcp of status.mcp) {
      if (mcp.state === "missing") {
        ui.dim(`mcp ${mcp.name} not installed`);
      }
    }
  }
}

function printHostManagedCollisions(preview: ProfileApplyPreview): void {
  const collisionCount = preview.host_managed?.cursor?.collisions.length ?? 0;
  if (collisionCount > 0) {
    ui.warn(
      `${collisionCount} Cursor host-managed skill name collision(s) with user or profile skills.`,
    );
  }
}

function printHumanPreview(preview: ProfileApplyPreview): void {
  ui.info(
    `Profile ${preview.profile}  scope=${preview.scope}  root=${preview.files.root_path}`,
  );
  if (preview.relative_to_active) {
    ui.dim("already active");
  }

  if (preview.warning) {
    ui.warn(preview.warning);
  }

  ui.subheader("Contents");
  const contents = preview.contents;
  const hasPlugins = (contents?.plugins.length ?? 0) > 0;
  const hasPins = (contents?.plugin_pins.length ?? 0) > 0;
  if (contents?.stack_summary) {
    ui.dim(contents.stack_summary);
  }
  if (!contents || (!hasPlugins && !hasPins)) {
    ui.hint("Add plugins or resources from your library.");
  } else {
    for (const plugin of contents.plugins) {
      ui.info(`plugin ${plugin.name}@${plugin.version}`);
      for (const resource of plugin.resources) {
        ui.dim(`  ${resource.type}:${resource.name}`);
      }
    }
    for (const pin of contents.plugin_pins) {
      ui.info(`pin ${pin.ref}@${pin.version_constraint}`);
    }
  }

  ui.subheader("Files");
  const changeCount = preview.files.changes.length;
  ui.dim(`${changeCount} would change · ${preview.files.expected_count} managed`);
  if (changeCount === 0) {
    ui.hint("No file changes.");
  } else {
    for (const change of preview.files.changes) {
      const resource = change.resource
        ? `  [${change.resource.type}:${change.resource.name}]`
        : "";
      ui.info(`${change.type}  ${change.path}${resource}`);
    }
  }
  printInstallGaps(preview);

  const untracked = preview.not_staged.length > 0
    ? preview.not_staged
    : preview.untracked_resources;
  if (untracked.length > 0) {
    ui.subheader("Untracked");
    for (const resource of untracked) {
      ui.info(`${resource.type}:${resource.name}  ${resource.source}`);
    }
  }

  if (preview.recovery_actions && preview.recovery_actions.length > 0) {
    ui.subheader("Recovery");
    for (const action of preview.recovery_actions) {
      ui.warn(`${action.id}  ${action.label}`);
    }
    ui.hint("Recovery stays interactive on apply; preview does not run these.");
    ui.hint("File adopt/restore is a separate command.");
  }

  printHostManagedCollisions(preview);
}

export async function handleProfilePreviewCommand(
  name: string | undefined,
  opts: {
    scope?: string;
    project?: string;
    harness?: string;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const cliScope = parseCliPreviewScope(opts.scope);
  const projectPath = resolveProjectPathForScope(cliScope, opts.project);
  const harness = opts.harness?.trim() || undefined;

  const resolvedName = await resolvePreviewProfileName({
    name,
    format: opts.format,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
  });
  if (!resolvedName) {
    process.exitCode = 1;
    renderCliError(missingRequiredArg("name", "profile preview"));
    return;
  }

  const scopes = engineScopes(cliScope);
  const previews: ProfileApplyPreview[] = [];
  for (const scope of scopes) {
    previews.push(
      await loadPreview({
        profile: resolvedName,
        scope,
        projectPath,
        harness,
      }),
    );
  }

  if (format === "json") {
    if (cliScope === "both") {
      printJson({ home: previews[0], project: previews[1] });
    } else {
      printJson(previews[0]);
    }
    return;
  }

  if (cliScope === "both") {
    const [homePreview, projectPreview] = previews;
    if (homePreview === undefined || projectPreview === undefined) {
      throw new Error("expected home and project apply previews");
    }
    ui.header("Home");
    printHumanPreview(homePreview);
    ui.header("Project");
    printHumanPreview(projectPreview);
    return;
  }

  const [preview] = previews;
  if (preview === undefined) {
    throw new Error("expected apply preview");
  }
  printHumanPreview(preview);
}

export function registerProfilePreviewCommand(profileCmd: Command): void {
  COMMAND_HELP_REGISTRY["profile.preview"] = {
    description: PROFILE_PREVIEW_HELP.description,
    examples: [...PROFILE_PREVIEW_HELP.examples],
  };

  profileCmd
    .command("preview")
    .argument("[name]", "Profile plugin name or selector")
    .option("--scope <home|project|both>", "Apply preview scope", "home")
    .option("--project <path>", "Project directory for project scope", ".")
    .option("--harness <slugs>", "Comma-separated harness slugs forwarded to preview")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--no-interactive", "Disable interactive wizards")
    .option("--interactive", "Prompt instead of relying on explicit flags")
    .description(PROFILE_PREVIEW_HELP.description)
    .action(async (
      name: string | undefined,
      opts: {
        scope?: string;
        project?: string;
        harness?: string;
        format?: string;
        interactive?: boolean;
        noInteractive?: boolean;
      },
    ) => {
      try {
        await handleProfilePreviewCommand(name, opts);
      } catch (error) {
        if (isPromptCancellationError(error)) {
          process.exitCode = 1;
          return;
        }
        process.exitCode = 1;
        renderCliError(error);
      }
    });
}
