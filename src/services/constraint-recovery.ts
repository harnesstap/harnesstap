import { resolvePluginSelector } from "../models/plugin-model.js";
import type { OutputFormat } from "../utils/output-format.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import {
  listDependencies,
  removeDependency,
} from "./plugin-dependency.js";
import {
  clearPluginVersionOverride,
  setPluginVersionOverride,
} from "./plugin-overrides.js";
import { syncPluginPinsForApply } from "./plugin-pin-apply.js";
import { resolveRemotePluginSelector } from "./plugin-selector.js";
import type { RecoveryAction, UnsatisfiableConstraintError } from "./resolve/types.js";
import {
  promptForChoice,
  shouldUseWizard,
} from "./wizards/shared.js";

export interface RunConstraintRecoveryInput {
  rootName: string;
  action: RecoveryAction;
  /** Required when action.id === "override-version". */
  chosenVersion?: string;
  projectRoot?: string;
}

function catalogDependencyMatches(
  dependency: { name: string; ref: string; source_kind: string },
  pluginName: string,
): boolean {
  return (
    dependency.source_kind === "catalog"
    && (dependency.name === pluginName
      || dependency.ref === pluginName
      || dependency.ref.endsWith(`/${pluginName}`))
  );
}

function marketplaceDependencyMatches(
  dependency: { name: string; ref: string; source_kind: string },
  pluginName: string,
): boolean {
  return (
    dependency.source_kind === "marketplace"
    && (dependency.name === pluginName
      || dependency.ref === pluginName
      || dependency.ref.endsWith(`/${pluginName}`))
  );
}

export async function runConstraintRecovery(
  input: RunConstraintRecoveryInput,
): Promise<void> {
  const root = resolvePluginSelector(input.rootName);
  if (!root) {
    throw new Error(`Plugin not found: ${input.rootName}`);
  }

  const action = input.action;
  switch (action.id) {
    case "detach-dependency": {
      const removed = removeDependency(root.id, action.pluginName);
      if (!removed) {
        throw new Error(
          `Dependency ${action.pluginName} not found on ${input.rootName}`,
        );
      }
      return;
    }
    case "clear-override": {
      clearPluginVersionOverride(root.id, action.pluginName);
      return;
    }
    case "override-version": {
      const version = input.chosenVersion;
      if (!version) {
        throw new Error(`chosenVersion is required to override ${action.pluginName}`);
      }
      setPluginVersionOverride(root.id, action.pluginName, version);
      return;
    }
    case "sync-install": {
      if (action.sourceKind === "catalog") {
        const catalogDeps = listDependencies(root.id).filter((dependency) =>
          catalogDependencyMatches(dependency, action.pluginName),
        );
        if (catalogDeps.length === 0) {
          throw new Error(
            `Cannot pull ${action.pluginName} from catalog: no catalog dependency on ${input.rootName}. Use a fully qualified selector (org/catalog/${action.pluginName}).`,
          );
        }
        if (catalogDeps.length > 1) {
          throw new Error(
            `Cannot pull ${action.pluginName}: multiple catalog dependencies match. Use ht plugin pull with org/catalog/${action.pluginName}.`,
          );
        }
        const dependency = catalogDeps[0]!;
        const constraint = dependency.version_constraint;
        const version =
          constraint && constraint !== "*" && constraint !== "latest"
            ? constraint
            : undefined;
        const parsed = resolveRemotePluginSelector(dependency.ref, { version });
        await installPluginFromCatalog(parsed);
        return;
      }

      if (action.sourceKind === "marketplace") {
        const pins = listDependencies(root.id)
          .filter((dependency) =>
            marketplaceDependencyMatches(dependency, action.pluginName),
          )
          .map((dependency) => ({
            ref: dependency.ref,
            version_constraint: dependency.version_constraint || "*",
          }));
        if (pins.length === 0) {
          throw new Error(
            `No marketplace pin for ${action.pluginName} on ${input.rootName}`,
          );
        }
        await syncPluginPinsForApply({
          pins,
          syncAll: true,
          projectRoot: input.projectRoot ?? resolveHomeRoot(),
        });
        return;
      }

      throw new Error(
        `Automated sync-install is only supported for marketplace and catalog dependencies. Create or import ${action.pluginName} first (ht plugin create ${action.pluginName}).`,
      );
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export interface OfferConstraintRecoveryInput {
  error: UnsatisfiableConstraintError;
  rootName: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format: OutputFormat;
  projectRoot?: string;
}

/**
 * TTY chooser over error.actions. Returns true when an action ran successfully.
 */
export async function offerConstraintRecovery(
  input: OfferConstraintRecoveryInput,
): Promise<boolean> {
  const usable = shouldUseWizard({
    interactive: input.interactive,
    noInteractive: input.noInteractive,
    format: input.format,
    missingRequiredArgs: true,
  });
  if (!usable || input.error.actions.length === 0) {
    return false;
  }

  const choice = await promptForChoice({
    message: "How do you want to fix this?",
    choices: [
      ...input.error.actions.map((action) => ({
        name: action.label,
        value: action.id + "::" + action.pluginName,
      })),
      { name: "Cancel", value: "cancel" },
    ],
  });
  if (!choice || choice === "cancel") {
    return false;
  }

  const action = input.error.actions.find(
    (candidate) => `${candidate.id}::${candidate.pluginName}` === choice,
  );
  if (!action) {
    return false;
  }

  let chosenVersion: string | undefined;
  if (action.id === "override-version") {
    if (action.versions.length === 0) {
      return false;
    }
    const picked = await promptForChoice({
      message: `Which version of ${action.pluginName}?`,
      choices: action.versions.map((version) => ({
        name: version,
        value: version,
      })),
    });
    if (!picked) return false;
    chosenVersion = picked;
  }

  await runConstraintRecovery({
    rootName: input.rootName,
    action,
    ...(chosenVersion ? { chosenVersion } : {}),
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
  });
  return true;
}
