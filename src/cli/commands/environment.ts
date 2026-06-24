import { resolve } from "node:path";
import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { listEnvironments } from "../../models/environment.js";
import { getLayerById, resolveLayerSelector } from "../../models/layer-model.js";
import {
  deleteEnvironmentCommand,
  listEnvironmentsCommand,
  setEnvironmentModelConfigCommand,
  setEnvironmentPermissionCommand,
  setEnvironmentSecretCommand,
  setEnvironmentVarCommand,
  showEnvironmentCommand,
  unsetEnvironmentModelConfigCommand,
  unsetEnvironmentPermissionCommand,
  unsetEnvironmentSecretCommand,
  unsetEnvironmentVarCommand,
  useEnvironmentCommand,
} from "../../services/environment-commands.js";
import { analyzeEnvironmentGaps } from "../../services/environment-requirements.js";
import { runEnvironmentCreate } from "../../services/environment-create.js";
import { buildEnvironmentEditRows } from "../../services/environment-edit.js";
import { detectEnvironmentStatus } from "../../services/environment-status.js";
import { renderEnvironmentShow } from "../../services/environment-show-render.js";
import { resolveEnvironmentOrThrow } from "../../services/environment-selectors.js";
import { listEnvironmentReferences } from "../../models/environment.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import { runEnvironmentCreateWizard } from "../../services/wizards/environment-create.js";
import { runEnvironmentDeleteWizard } from "../../services/wizards/environment-delete.js";
import { runEnvironmentEditWizard } from "../../services/wizards/environment-edit.js";
import { runEnvironmentShowWizard } from "../../services/wizards/environment-show.js";
import {
  filterEnvironmentListRows,
  runEnvironmentListWizard,
} from "../../services/wizards/environment-list.js";
import { renderEnvironmentListTable } from "../../ui/environment-list-render.js";
import type { Layer, PermissionMetadata } from "../../types.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { configureCommandGroup } from "../help.js";
import { renderCliError } from "../runtime.js";
import { collectRepeatedOption, formatCommand } from "../shared.js";
import {
  isPromptCancellationError,
  promptForConfirmation,
  promptForSearchableChoice,
  resolveOrPrompt,
  shouldUseWizard,
} from "../../services/wizards/shared.js";

function formatLayerLabel(layer: Pick<Layer, "name" | "version">): string {
  return `${layer.name}@${layer.version}`;
}

function parseVarAssignment(raw: string): { key: string; value: string } {
  const idx = raw.indexOf("=");
  if (idx <= 0) {
    throw new Error(`Invalid --var entry "${raw}". Expected KEY=VALUE.`);
  }
  return {
    key: raw.slice(0, idx),
    value: raw.slice(idx + 1),
  };
}

function parsePermissionPattern(
  raw: string,
): { action: PermissionMetadata["action"]; pattern: string } {
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx >= raw.length - 1) {
    throw new Error(`Invalid permission "${raw}". Expected action:pattern.`);
  }
  const action = raw.slice(0, idx) as PermissionMetadata["action"];
  if (!["allow", "deny", "ask"].includes(action)) {
    throw new Error(`Invalid permission action "${action}". Use allow, deny, or ask.`);
  }
  return {
    action,
    pattern: raw.slice(idx + 1),
  };
}

function parsePermissionUnsetSelector(
  raw: string,
): { action?: PermissionMetadata["action"]; pattern?: string; name?: string } {
  try {
    const parsed = parsePermissionPattern(raw);
    return parsed;
  } catch {
    return { name: raw };
  }
}

function renderEnvironmentShowHuman(
  payload: ReturnType<typeof showEnvironmentCommand>,
  requirementGaps?: ReturnType<typeof analyzeEnvironmentGaps>,
): void {
  console.log(renderEnvironmentShow(payload, { requirementGaps }));
}
function printEnvironmentMutationResult(
  payload: ReturnType<typeof showEnvironmentCommand>,
  format: "human" | "json",
): void {
  if (format === "json") {
    printJson(payload);
    return;
  }
  renderEnvironmentShowHuman(payload);
}

function shouldUseInteractiveEnvironmentEdit(input: {
  noInteractive?: boolean;
  format?: string;
}): boolean {
  return shouldUseWizard({
    interactive: true,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });
}

function shouldUseInteractiveEnvironmentList(input: {
  noInteractive?: boolean;
  format?: string;
  search?: string;
}): boolean {
  if (input.search) {
    return false;
  }

  return shouldUseWizard({
    interactive: true,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });
}

async function handleEnvironmentListCommand(opts: {
  format?: string;
  search?: string;
  noInteractive?: boolean;
}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  let search = opts.search;
  if (shouldUseInteractiveEnvironmentList(opts)) {
    try {
      while (true) {
        const wizardResult = await runEnvironmentListWizard({ search });
        if (!wizardResult) {
          break;
        }

        switch (wizardResult.action) {
          case "edit":
            await handleEnvironmentEditCommand(wizardResult.name, {
              format: opts.format,
              interactive: true,
            });
            search = undefined;
            continue;
          case "delete":
            await handleEnvironmentDeleteCommand(wizardResult.name, {
              format: opts.format,
              interactive: true,
            });
            search = undefined;
            continue;
          case "filter":
            search = wizardResult.query.length > 0 ? wizardResult.query : undefined;
            break;
          default: {
            const _exhaustive: never = wizardResult;
            throw _exhaustive;
          }
        }
        break;
      }
    } catch (error) {
      if (isPromptCancellationError(error)) {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  const environments = filterEnvironmentListRows(listEnvironmentsCommand(), search);
  if (format === "json") {
    printJson(environments);
    return;
  }

  if (environments.length === 0) {
    console.log(
      `No environments found.\n  → Run \`${formatCommand("environment create <name>")}\` to add one.`,
    );
    return;
  }

  console.log(renderEnvironmentListTable(environments));
}

async function resolveEnvironmentMutationTarget(input: {
  environmentName?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
  message: string;
}): Promise<string | undefined> {
  const format = parseOutputFormat(input.format);
  const choices = listEnvironments().map((environment) => ({
    name: environment.name,
    value: environment.name,
  }));

  return resolveOrPrompt({
    value: input.environmentName,
    shouldPrompt: shouldUseWizard({
      interactive: input.interactive,
      noInteractive: input.noInteractive,
      format,
      missingRequiredArgs: !input.environmentName,
    }),
    prompt: async () => {
      if (choices.length === 0) {
        return undefined;
      }
      return promptForSearchableChoice({
        message: input.message,
        choices,
      });
    },
  });
}

function printEnvironmentEditJsonSnapshot(
  environment: ReturnType<typeof resolveEnvironmentOrThrow>,
  rows: ReturnType<typeof buildEnvironmentEditRows>,
): void {
  printJson({
    environment: {
      id: environment.id,
      name: environment.name,
    },
    rows,
  });
}

async function handleEnvironmentEditCommand(
  name: string | undefined,
  opts: {
    format?: string;
    interactive?: boolean;
    yes?: boolean;
    var?: string[];
    unsetVar?: string[];
    model?: string;
    modelProvider?: string;
    unsetModel?: string | boolean;
    permission?: string[];
    unsetPermission?: string[];
    secret?: string[];
    unsetSecret?: string[];
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const noInteractive = opts.yes;

  const secretEntries = (opts.secret ?? []).map((entry) => {
    const parts = entry.split(":");
    if (parts.length < 3) {
      throw new Error(`Invalid --secret entry "${entry}". Expected KEY:provider:ref.`);
    }
    const [key, provider, ...refParts] = parts;
    if (!key || !provider) {
      throw new Error(`Invalid --secret entry "${entry}". Expected KEY:provider:ref.`);
    }
    const providerValue = provider as "keychain" | "env" | "file";
    if (!["keychain", "env", "file"].includes(providerValue)) {
      throw new Error(`Invalid secret provider "${provider}". Use keychain, env, or file.`);
    }
    return {
      key,
      provider: providerValue,
      ref: refParts.join(":"),
    };
  });

  const scripting = (opts.var?.length ?? 0) > 0
    || (opts.unsetVar?.length ?? 0) > 0
    || opts.model !== undefined
    || opts.unsetModel !== undefined
    || (opts.permission?.length ?? 0) > 0
    || (opts.unsetPermission?.length ?? 0) > 0
    || secretEntries.length > 0
    || (opts.unsetSecret?.length ?? 0) > 0;

  const resolvedName = name ?? (scripting
    ? undefined
    : await resolveEnvironmentMutationTarget({
        environmentName: name,
        interactive: opts.interactive,
        noInteractive,
        format: opts.format,
        message: "Which environment do you want to edit?",
      }));

  if (!resolvedName) {
    process.exitCode = 1;
    ui.danger(
      scripting || listEnvironments().length > 0
        ? "error: missing required argument 'name'"
        : `No environments found. Create one with \`${formatCommand("environment create <name>")}\` first.`,
    );
    return;
  }

  const environment = resolveEnvironmentOrThrow(resolvedName);

  if (scripting) {
    let lastPayload: ReturnType<typeof showEnvironmentCommand> | undefined;
    for (const entry of opts.var ?? []) {
      const parsed = parseVarAssignment(entry);
      lastPayload = setEnvironmentVarCommand(resolvedName, parsed.key, parsed.value);
    }
    for (const key of opts.unsetVar ?? []) {
      lastPayload = unsetEnvironmentVarCommand(resolvedName, key);
    }
    if (opts.model) {
      lastPayload = setEnvironmentModelConfigCommand(resolvedName, {
        model: opts.model,
        ...(opts.modelProvider ? { provider: opts.modelProvider } : {}),
      });
    }
    if (opts.unsetModel !== undefined) {
      const modelName =
        typeof opts.unsetModel === "string" && opts.unsetModel.length > 0
          ? opts.unsetModel
          : "default";
      lastPayload = unsetEnvironmentModelConfigCommand(resolvedName, modelName);
    }
    for (const entry of opts.permission ?? []) {
      lastPayload = setEnvironmentPermissionCommand(resolvedName, parsePermissionPattern(entry));
    }
    for (const entry of opts.unsetPermission ?? []) {
      lastPayload = unsetEnvironmentPermissionCommand(
        resolvedName,
        parsePermissionUnsetSelector(entry),
      );
    }
    for (const secret of secretEntries) {
      lastPayload = setEnvironmentSecretCommand(resolvedName, secret);
    }
    for (const key of opts.unsetSecret ?? []) {
      lastPayload = unsetEnvironmentSecretCommand(resolvedName, key);
    }
    const payload = lastPayload ?? showEnvironmentCommand(resolvedName);
    printEnvironmentMutationResult(payload, format);
    return;
  }

  const rows = buildEnvironmentEditRows(environment.id);

  if (format === "json" && !shouldUseInteractiveEnvironmentEdit({ noInteractive, format: opts.format })) {
    printEnvironmentEditJsonSnapshot(environment, rows);
    return;
  }

  if (!shouldUseInteractiveEnvironmentEdit({ noInteractive, format: opts.format })) {
    process.exitCode = 1;
    ui.danger(
      `environment edit requires an interactive terminal. Use scripting flags such as \`${formatCommand("environment edit <name> --var KEY=VALUE")}\` or \`${formatCommand("environment edit <name> --format json")}\` for a snapshot.`,
    );
    return;
  }

  try {
    const result = await runEnvironmentEditWizard({ environment });
    if (!result) {
      ui.info("Operation cancelled.");
      return;
    }
    ui.success(`Updated environment ${ui.theme.accent(environment.name)}`);
  } catch (error) {
    if (isPromptCancellationError(error)) {
      ui.info("Operation cancelled.");
      return;
    }
    throw error;
  }
}

function renderEnvironmentDeleteReferences(
  references: ReturnType<typeof listEnvironmentReferences>,
): void {
  if (references.layers.length === 0) {
    return;
  }

  ui.subheader("REFERENCES");
  ui.table.print({
    columns: [
      { key: "layer", header: "LAYER", width: 40 },
    ],
    rows: references.layers.map((ref) => {
      const layer = getLayerById(ref.id);
      return {
        layer: layer ? formatLayerLabel(layer) : ref.name,
      };
    }),
  });
}

async function handleEnvironmentDeleteCommand(
  name: string | undefined,
  opts: {
    search?: string;
    force?: boolean;
    format?: string;
    interactive?: boolean;
    yes?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.yes,
    format,
    missingRequiredArgs: !name,
  });

  const selectors = name
    ? [name]
    : useWizard
      ? await runEnvironmentDeleteWizard({ search: opts.search })
      : [];

  const resolvedName = selectors[0];
  if (!resolvedName) {
    throw !name && useWizard
      ? new Error("No environment selected for deletion")
      : missingRequiredArg("name", "environment delete");
  }

  const environment = resolveEnvironmentOrThrow(resolvedName);
  const references = listEnvironmentReferences(environment.id);

  let confirmedWithReferences = false;
  if (useWizard && !opts.force) {
    renderEnvironmentDeleteReferences(references);
    const confirmed = await promptForConfirmation({
      message: references.layers.length > 0
        ? `Delete environment "${environment.name}" even though it is referenced?`
        : `Delete environment "${environment.name}"?`,
      default: false,
    });
    if (!confirmed) {
      ui.info("Operation cancelled.");
      return;
    }
    confirmedWithReferences = references.layers.length > 0;
  }

  const result = deleteEnvironmentCommand(resolvedName, {
    force: Boolean(opts.force || confirmedWithReferences),
  });

  if (format === "json") {
    printJson(result);
    return;
  }
  ui.success(`Deleted environment ${ui.theme.accent(environment.name)}`);
}

function hasExplicitCreateMode(opts: {
  blank?: boolean;
  fromProject?: string;
  fromLayer?: string[];
}): boolean {
  return Boolean(
    opts.blank || opts.fromProject || (opts.fromLayer && opts.fromLayer.length > 0),
  );
}

function printEnvironmentCreateResult(
  result: Awaited<ReturnType<typeof runEnvironmentCreate>>,
  opts: {
    name: string;
    fromProject?: string;
    refresh?: boolean;
    format: "human" | "json";
  },
): void {
  if (result.mode === "blank") {
    if (opts.format === "json") {
      printJson(result.payload.environment);
      return;
    }
    ui.success(`Created environment ${ui.theme.accent(result.payload.environment.name)}`);
    return;
  }

  if (result.mode === "from-project") {
    const captureResult = result.result;
    if (opts.format === "json") {
      printJson(captureResult);
    } else {
      const action = opts.refresh ? "refresh" : "create";
      ui.panel({
        title: ["ENVIRONMENT", `${action} ${opts.name}`],
        rows: [
          ["Project", opts.fromProject ? resolve(opts.fromProject) : "—"],
          ["Main harness", captureResult.main_harness],
          ["Configured layers", `${captureResult.configured_layer_ids.length}`],
          ["Persisted", captureResult.persisted ? "yes" : "no"],
          ["Missing keys", `${captureResult.missing_keys.length}`],
        ],
      });
      if (captureResult.missing_keys.length > 0) {
        ui.subheader("MISSING KEYS");
        for (const missing of captureResult.missing_keys) {
          const sources =
            missing.sources.length > 0 ? missing.sources.join(", ") : "unknown";
          ui.warn(`${missing.key} (${sources})`);
        }
      }
    }

    if (captureResult.strict_failed) {
      process.exitCode = 1;
      if (opts.format === "human") {
        ui.danger("Strict mode failed: missing required environment keys.");
      }
    }
    return;
  }

  const fromLayerResult = result.preview;
  if (opts.format === "json") {
    printJson({
      ...fromLayerResult,
      environment: result.payload.environment,
      persisted: result.persisted,
    });
  } else {
    ui.panel({
      title: ["ENVIRONMENT", `create ${opts.name} from layer`],
      rows: [
        ["Configured layers", `${fromLayerResult.configured_layer_ids.length}`],
        ["Persisted", result.persisted ? "yes" : "no"],
        ["Missing keys", `${fromLayerResult.missing_keys.length}`],
        ["Bound layers", `${fromLayerResult.bound_layer_ids.length}`],
      ],
    });
    if (fromLayerResult.missing_keys.length > 0) {
      ui.subheader("MISSING KEYS");
      for (const missing of fromLayerResult.missing_keys) {
        const sources =
          missing.sources.length > 0 ? missing.sources.join(", ") : "unknown";
        ui.warn(`${missing.key} (${sources})`);
      }
    }
    if (result.persisted) {
      ui.success(`Created environment ${ui.theme.accent(opts.name)}`);
    }
  }

  if (fromLayerResult.strict_failed) {
    process.exitCode = 1;
    if (opts.format === "human") {
      ui.danger("Strict mode failed: missing required environment keys.");
    }
  }
}

async function handleEnvironmentCreateCommand(
  name: string,
  opts: {
    blank?: boolean;
    fromProject?: string;
    fromLayer?: string[];
    refresh?: boolean;
    bind?: boolean;
    layers?: string[];
    strict?: boolean;
    dryRun?: boolean;
    includePermissions?: boolean;
    description?: string;
    format?: string;
    interactive?: boolean;
    yes?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.yes,
    format: opts.format,
    missingRequiredArgs: !hasExplicitCreateMode(opts),
  });

  if (useWizard) {
    try {
      const wizardOutcome = await runEnvironmentCreateWizard({
        name,
        description: opts.description,
      });
      printEnvironmentCreateResult(wizardOutcome.result, {
        name,
        fromProject: opts.fromProject,
        refresh: opts.refresh,
        format,
      });
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      throw error;
    }
    return;
  }

  const fromLayer = opts.fromLayer?.length
    ? opts.fromLayer.flatMap((entry) =>
        entry.split(",").map((part) => part.trim()).filter(Boolean),
      )
    : undefined;

  const result = await runEnvironmentCreate({
    name,
    ...(opts.blank ? { blank: true } : {}),
    ...(opts.fromProject ? { fromProject: resolve(opts.fromProject) } : {}),
    ...(fromLayer ? { fromLayer } : {}),
    refresh: opts.refresh,
    bind: opts.bind,
    layers: opts.layers,
    strict: opts.strict,
    dryRun: opts.dryRun,
    includePermissions: opts.includePermissions,
    description: opts.description,
  });

  printEnvironmentCreateResult(result, {
    name,
    fromProject: opts.fromProject,
    refresh: opts.refresh,
    format,
  });
}

async function handleEnvironmentUseCommand(
  name: string,
  opts: { local?: boolean; format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const payload = useEnvironmentCommand(name, { local: opts.local });
  if (format === "json") {
    printJson(payload);
    return;
  }
  const scopeLabel = payload.scope === "local" ? "local session" : "global";
  ui.success(
    `Set ${scopeLabel} environment ${ui.theme.accent(payload.environment_name)}`,
  );
  if (payload.scope === "local") {
    ui.hint(
      `Session override is active for this terminal. Global environment remains ${ui.theme.muted("unchanged")}.`,
    );
  }
}

async function handleEnvironmentStatusCommand(opts: {
  layers?: string[];
  check?: boolean;
  format?: string;
}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const configuredLayerIds = opts.layers?.map((selector) => {
    const configuredLayer = resolveLayerSelector(selector);
    if (!configuredLayer) {
      throw new Error(`Configured layer not found: ${selector}`);
    }
    return configuredLayer.id;
  }) ?? [];

  try {
    const status = detectEnvironmentStatus({ configuredLayerIds });
    if (format === "json") {
      printJson(status);
    } else {
      for (const warning of status.secret_warnings) {
        ui.warn(`${warning.key}: ${warning.message}`);
      }

      if (!status.effective_environment) {
        ui.info("No active environment set.");
        ui.hint(`Run ${formatCommand("environment use <name>")} to select one globally.`);
      } else if (!status.has_drift) {
        ui.success(
          `Terminal environment is in sync with ${ui.theme.accent(status.effective_environment)}.`,
        );
        if (status.local_environment) {
          ui.dim(`Local session override: ${status.local_environment}`);
        }
      } else {
        ui.warn(
          `Terminal environment is out of sync with ${ui.theme.accent(status.effective_environment)}.`,
        );
        if (status.local_environment) {
          ui.dim(`Local session override: ${status.local_environment}`);
        }
        ui.table.print({
          columns: [
            { key: "key", header: "KEY", width: 24 },
            { key: "kind", header: "KIND", width: 10 },
            { key: "expected", header: "EXPECTED", width: 28 },
            { key: "actual", header: "ACTUAL", width: 28 },
          ],
          rows: status.drift.map((entry) => ({
            key: entry.key,
            kind: entry.kind,
            expected: entry.expected,
            actual: entry.actual ?? "(unset)",
          })),
          empty: "No drift detected.",
        });
        ui.hint(
          `Export expected values in your shell or run ${formatCommand(`environment use ${status.effective_environment}`)} after updating process env.`,
        );
      }
    }

    if (opts.check && status.has_drift) {
      process.exitCode = 1;
    }
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}
// ── environment ──────────────────────────────────────────────────────────


export function registerEnvironmentCommands(root: Command): void {
  const environmentCmd = configureCommandGroup(
  root
    .command("environment")
    .alias("e")
    .description("Manage reusable environments and layer environment cascade"),
);

environmentCmd
  .command("create")
  .argument("<name>", "Environment name")
  .option("--blank", "Create an empty environment")
  .option("--from-project <path>", "Create from project harness configuration")
  .option(
    "--from-layer <layer>",
    "Create from configured layer requirements (repeatable or comma-separated)",
    collectRepeatedOption,
    [],
  )
  .option("--refresh", "Refresh an existing environment (--from-project only)")
  .option("--bind", "Bind environment as layer default (--from-layer only)")
  .option("--layers <layers...>", "Configured layer selectors for --from-project")
  .option("--strict", "Fail when required keys are missing")
  .option("--dry-run", "Preview without persisting")
  .option("--include-permissions", "Include scanned permission resources")
  .option("--description <text>", "Environment description")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("-y, --yes", "Skip interactive prompts")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Create a blank, project-scoped, or layer-derived environment")
  .action(async (
    name: string,
    opts: {
      blank?: boolean;
      fromProject?: string;
      fromLayer?: string[];
      refresh?: boolean;
      bind?: boolean;
      layers?: string[];
      strict?: boolean;
      dryRun?: boolean;
      includePermissions?: boolean;
      description?: string;
      interactive?: boolean;
      yes?: boolean;
      format?: string;
    },
  ) => {
    try {
      await handleEnvironmentCreateCommand(name, opts);
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      process.exitCode = 1;
      renderCliError(error);
    }
  });

environmentCmd
  .command("edit")
  .argument("[name]", "Environment name or ID")
  .option("--var <keyValue>", "Set env var KEY=VALUE (scripting mode)", (value, previous: string[] = []) => [...previous, value], [])
  .option("--unset-var <key>", "Unset env var key (scripting mode)", (value, previous: string[] = []) => [...previous, value], [])
  .option("--model <name>", "Set default model name (scripting mode)")
  .option("--model-provider <provider>", "Provider for --model")
  .option("--unset-model [name]", "Unset model config (scripting mode)")
  .option("--permission <actionPattern>", "Set permission action:pattern (scripting mode)", (value, previous: string[] = []) => [...previous, value], [])
  .option("--unset-permission <selector>", "Unset permission action:pattern or name (scripting mode)", (value, previous: string[] = []) => [...previous, value], [])
  .option("--secret <keyProviderRef>", "Set secret ref KEY:provider:ref (scripting mode)", (value, previous: string[] = []) => [...previous, value], [])
  .option("--unset-secret <key>", "Unset secret ref key (scripting mode)", (value, previous: string[] = []) => [...previous, value], [])
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("-y, --yes", "Skip interactive prompts")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Edit environment values interactively or via scripting flags")
  .action(async (
    name: string | undefined,
    opts: {
      var?: string[];
      unsetVar?: string[];
      model?: string;
      modelProvider?: string;
      unsetModel?: string | boolean;
      permission?: string[];
      unsetPermission?: string[];
      secret?: string[];
      unsetSecret?: string[];
      interactive?: boolean;
      yes?: boolean;
      format?: string;
    },
  ) => {
    try {
      await handleEnvironmentEditCommand(name, opts);
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      process.exitCode = 1;
      renderCliError(error);
    }
  });

environmentCmd
  .command("list")
  .alias("ls")
  .option("-s, --search <query>", "Search by name or description (skips interactive filter)")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List local environments with value and reference counts")
  .action(async (opts: { format?: string; search?: string; noInteractive?: boolean }) => {
    try {
      await handleEnvironmentListCommand(opts);
    } catch (error) {
      process.exitCode = 1;
      renderCliError(error);
    }
  });

environmentCmd
  .command("show")
  .argument("[name]", "Environment name or ID")
  .option("--layer <selector>", "Analyze requirement gaps for a configured layer")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--no-interactive", "Disable interactive wizards")
  .description("Show environment values, secret refs, and layer references")
  .action(async (
    name: string | undefined,
    opts: {
      format?: string;
      layer?: string;
      interactive?: boolean;
      noInteractive?: boolean;
    },
  ) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const resolvedName = await resolveOrPrompt({
      value: name,
      shouldPrompt: shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format,
        missingRequiredArgs: !name,
      }),
      prompt: async () => runEnvironmentShowWizard(),
    });
    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger(
        listEnvironments().length > 0
          ? "error: missing required argument 'name'"
          : `No environments found. Create one with \`${formatCommand("environment create <name>")}\` first.`,
      );
      return;
    }
    const payload = showEnvironmentCommand(resolvedName);
    const requirementGaps = opts.layer
      ? analyzeEnvironmentGaps(payload.environment.id, opts.layer)
      : undefined;
    if (format === "json") {
      printJson(
        requirementGaps !== undefined
          ? { ...payload, requirement_gaps: requirementGaps }
          : payload,
      );
      return;
    }
    renderEnvironmentShowHuman(payload, requirementGaps);
  });

environmentCmd
  .command("delete")
  .argument("[name]", "Environment name or ID")
  .option("-s, --search <query>", "Filter environments in the delete wizard")
  .option("--force", "Delete even if references exist")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("-y, --yes", "Skip interactive prompts")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Delete an environment (blocked when referenced unless --force)")
  .action(async (
    name: string | undefined,
    opts: {
      search?: string;
      force?: boolean;
      format?: string;
      interactive?: boolean;
      yes?: boolean;
    },
  ) => {
    try {
      await handleEnvironmentDeleteCommand(name, opts);
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      process.exitCode = 1;
      renderCliError(error);
    }
  });

environmentCmd
  .command("use")
  .argument("<name>", "Environment name or ID")
  .option("--local", "Apply only to this terminal session without changing the global active environment")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Set the global or local (session) active environment")
  .action(async (name: string, opts: { local?: boolean; format?: string }) => {
    await handleEnvironmentUseCommand(name, opts);
  });

environmentCmd
  .command("status")
  .option("--layers <layers...>", "Configured layer selectors to include layer default environments")
  .option("--check", "Exit with code 1 when the terminal environment is out of sync")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show the active environment and whether terminal env vars match expected values")
  .action(async (opts: { layers?: string[]; check?: boolean; format?: string }) => {
    await handleEnvironmentStatusCommand(opts);
  });
}
