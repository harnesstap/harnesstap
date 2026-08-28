import { PLUGIN_ATTACHMENT_TYPES } from "../plugin-composition.js";
import type { CompletionContext, CompletionProvider } from "./types.js";
import { completeCatalogConnectValue } from "./providers/catalog-connect-value.js";
import { completeCatalogPlugins } from "./providers/catalog-plugin.js";
import { completeCatalogProfiles } from "./providers/catalog-profile.js";
import { completeCatalogOrgs } from "./providers/catalog-org.js";
import { completeCloudAccounts } from "./providers/cloud-account.js";
import {
  completeDirectoryPath,
  completeFilePath,
  completePluginImportPath,
} from "./providers/file-path.js";
import { completeHarnessSlugs } from "./providers/harness-slug.js";
import { completePluginEditAddAttachment, completePluginEditRemoveAttachment } from "./providers/plugin-attachment.js";
import { completeLocalEnvironments } from "./providers/local-environment.js";
import { completeLocalPlugins } from "./providers/local-plugin.js";
import { completeProfilePlugins } from "./providers/profile-plugin.js";
import { completeProjectProfileKeys } from "./providers/project-profile.js";
import { completeLocalResources } from "./providers/local-resource.js";
import { completeResourceTypes } from "./providers/resource-type.js";
import { completeScenarioIds } from "./providers/scenario-id.js";
import { completeSnapshotIds } from "./providers/snapshot-id.js";
import { staticEnumProvider } from "./providers/static-enum.js";
import { flagsMatch } from "./utils.js";

type PositionalRegistry = Record<string, CompletionProvider[]>;
type FlagRegistry = Record<string, CompletionProvider[]>;

const LOCAL_PLUGIN_OR_FILE: CompletionProvider[] = [
  completeLocalPlugins,
  completeFilePath,
];

const POSITIONAL_PROVIDERS: PositionalRegistry = {
  "plugin show:0": [completeLocalPlugins],
  "plugin edit:0": [completeLocalPlugins],
  "plugin editor:0": [completeLocalPlugins],
  "plugin delete:0": [completeLocalPlugins],
  "apply:0": [completeLocalPlugins, completeFilePath],
  "plugin diff:0": LOCAL_PLUGIN_OR_FILE,
  "plugin diff:1": LOCAL_PLUGIN_OR_FILE,
  "plugin pull:0": [completeCatalogPlugins],
  "plugin publish:0": [completeLocalPlugins],
  "profile use:0": [completeProfilePlugins],
  "use:profile": [completeProjectProfileKeys],
  "profile use:profile": [completeProjectProfileKeys],
  "profile show:0": [completeProfilePlugins],
  "profile delete:0": [completeProfilePlugins],
  "profile pull:0": [completeCatalogProfiles],
  ":0": [completeProfilePlugins],
  "plugin catalog connect:1": [completeCatalogConnectValue],
  "plugin catalog disconnect:1": [completeCatalogConnectValue],
  "resource show:0": [completeLocalResources],
  "resource delete:0": [completeLocalResources],
  "resource list:0": [completeResourceTypes],
  "resource sync:0": [completeLocalResources],
  "environment edit:0": [completeLocalEnvironments],
  "environment show:0": [completeLocalEnvironments],
  "environment delete:0": [completeLocalEnvironments],
  "environment use:0": [completeLocalEnvironments],
  "migrate export:environment": [completeLocalEnvironments],
  "revert:0": [completeSnapshotIds],
  "migrate export:0": [completeFilePath],
  "migrate import:0": [completePluginImportPath, completeFilePath],
  "auth login:0": [completeCloudAccounts],
  "help scenario:0": [completeScenarioIds],
};

const FLAG_PROVIDERS: FlagRegistry = {
  "init:main": [completeHarnessSlugs],
  "init:aliases": [completeHarnessSlugs],
  "harness set:main": [completeHarnessSlugs],
  "harness set:aliases": [completeHarnessSlugs],
  "harness project set:main": [completeHarnessSlugs],
  "harness project set:aliases": [completeHarnessSlugs],
  "migrate export:plugin": [completeLocalPlugins],
  "migrate export:resource": [completeLocalResources],
  "plugin edit:type": [staticEnumProvider(PLUGIN_ATTACHMENT_TYPES)],
  "plugin edit:add": [completePluginEditAddAttachment],
  "plugin edit:remove": [completePluginEditRemoveAttachment],
  "plugin edit:environment": [completeLocalEnvironments],
  "plugin publish:org": [completeCatalogOrgs],
  "add:plugin": [completeLocalPlugins],
  "add:create-plugin": [completeLocalPlugins],
  "add:harness": [completeHarnessSlugs],
  "add:project": [completeDirectoryPath],
  "pack:output": [completeDirectoryPath],
  "pack:o": [completeDirectoryPath],
  "pack:project": [completeDirectoryPath],
  "audit:project": [completeDirectoryPath],
  "audit:file": [completeFilePath],
  "auth status:account": [completeCloudAccounts],
  "auth logout:account": [completeCloudAccounts],
  "auth orgs:account": [completeCloudAccounts],
  "auth orgs:switch": [completeCatalogOrgs],
};

const GLOBAL_FLAG_PROVIDERS: Record<string, CompletionProvider[]> = {
  format: [staticEnumProvider(["human", "json"])],
  harness: [completeHarnessSlugs],
  h: [completeHarnessSlugs],
  account: [completeCloudAccounts],
};

const PLUGIN_ACCOUNT_FLAGS = new Set(["account"]);

function positionalKey(commandPath: string[], index: number): string {
  return `${commandPath.join(" ")}:${index}`;
}

function flagKey(commandPath: string[], flag: string): string {
  return `${commandPath.join(" ")}:${flag}`;
}

function resolvePluginWildcardProviders(
  ctx: CompletionContext,
  slot: "flag-value" | "positional",
): CompletionProvider[] {
  if (!ctx.commandPath[0] || ctx.commandPath[0] !== "plugin") {
    return [];
  }

  if (slot === "flag-value" && ctx.flag && PLUGIN_ACCOUNT_FLAGS.has(ctx.flag)) {
    return [completeCloudAccounts];
  }

  return [];
}

export function lookupProviders(ctx: CompletionContext): CompletionProvider[] {
  const providers: CompletionProvider[] = [];

  if (ctx.slot === "flag-value" && ctx.flag) {
    const specific = FLAG_PROVIDERS[flagKey(ctx.commandPath, ctx.flag)];
    if (specific) {
      providers.push(...specific);
    }

    const global = GLOBAL_FLAG_PROVIDERS[ctx.flag];
    if (global) {
      providers.push(...global);
    }

    providers.push(...resolvePluginWildcardProviders(ctx, "flag-value"));

    if (flagsMatch(ctx.flag, "file")) {
      providers.push(completeFilePath);
    }
    if (flagsMatch(ctx.flag, "project")) {
      providers.push(completeDirectoryPath);
    }
    if (flagsMatch(ctx.flag, "main") || flagsMatch(ctx.flag, "aliases")) {
      providers.push(completeHarnessSlugs);
    }
  }

  if (ctx.slot === "positional" && ctx.positionalIndex !== undefined) {
    const specific = POSITIONAL_PROVIDERS[positionalKey(ctx.commandPath, ctx.positionalIndex)];
    if (specific) {
      providers.push(...specific);
    }
    providers.push(...resolvePluginWildcardProviders(ctx, "positional"));
  }

  return providers;
}
