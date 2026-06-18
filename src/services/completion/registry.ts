import { LAYER_ATTACHMENT_TYPES } from "../layer-composition.js";
import type { CompletionContext, CompletionProvider } from "./types.js";
import { completeCatalogConnectValue } from "./providers/catalog-connect-value.js";
import { completeCatalogLayers } from "./providers/catalog-layer.js";
import { completeCatalogProfiles } from "./providers/catalog-profile.js";
import { completeCatalogOrgs } from "./providers/catalog-org.js";
import { completeCloudAccounts } from "./providers/cloud-account.js";
import {
  completeDirectoryPath,
  completeFilePath,
  completeLayerImportPath,
} from "./providers/file-path.js";
import { completeHarnessSlugs } from "./providers/harness-slug.js";
import { completeLayerAttachment } from "./providers/layer-attachment.js";
import { completeLocalEnvironments } from "./providers/local-environment.js";
import { completeLocalLayers } from "./providers/local-layer.js";
import { completeProfileLayers } from "./providers/profile-layer.js";
import { completeLocalResources } from "./providers/local-resource.js";
import { completeResourceTypes } from "./providers/resource-type.js";
import { completeScenarioIds } from "./providers/scenario-id.js";
import { completeSnapshotIds } from "./providers/snapshot-id.js";
import { staticEnumProvider } from "./providers/static-enum.js";
import { flagsMatch } from "./utils.js";

type PositionalRegistry = Record<string, CompletionProvider[]>;
type FlagRegistry = Record<string, CompletionProvider[]>;

const LOCAL_LAYER_OR_FILE: CompletionProvider[] = [
  completeLocalLayers,
  completeFilePath,
];

const POSITIONAL_PROVIDERS: PositionalRegistry = {
  "layer show:0": [completeLocalLayers],
  "layer delete:0": [completeLocalLayers],
  "layer export:0": [completeLocalLayers],
  "layer import:0": [completeLayerImportPath],
  "layer apply:0": [completeLocalLayers],
  "layer combine:0": [completeLocalLayers],
  "layer combine:1": [completeLayerAttachment],
  "layer uncombine:0": [completeLocalLayers],
  "layer uncombine:1": [completeLayerAttachment],
  "layer diff:0": LOCAL_LAYER_OR_FILE,
  "layer diff:1": LOCAL_LAYER_OR_FILE,
  "layer set-environment:0": [completeLocalLayers],
  "layer set-environment:1": [completeLocalEnvironments],
  "layer unset-environment:0": [completeLocalLayers],
  "layer pull:0": [completeCatalogLayers],
  "layer search:0": [completeCatalogLayers],
  "layer publish:0": [completeLocalLayers],
  "profile use:0": [completeProfileLayers],
  "profile pull:0": [completeCatalogProfiles],
  "profile search:0": [completeCatalogProfiles],
  ":0": [completeProfileLayers],
  "layer catalog connect:1": [completeCatalogConnectValue],
  "layer catalog disconnect:1": [completeCatalogConnectValue],
  "resource show:0": [completeLocalResources],
  "resource delete:0": [completeLocalResources],
  "resource list:0": [completeResourceTypes],
  "resource sync:0": [completeLocalResources],
  "environment show:0": [completeLocalEnvironments],
  "environment delete:0": [completeLocalEnvironments],
  "environment set:0": [completeLocalEnvironments],
  "environment unset:0": [completeLocalEnvironments],
  "environment use:0": [completeLocalEnvironments],
  "environment capture:0": [completeLocalEnvironments],
  "environment refresh:0": [completeLocalEnvironments],
  "environment import:0": [completeFilePath],
  "environment export:0": [completeLocalEnvironments],
  "environment export:1": [completeFilePath],
  "revert:0": [completeSnapshotIds],
  "migrate export:0": [completeFilePath],
  "migrate import:0": [completeFilePath],
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
  "layer export:file": [completeFilePath],
  "layer combine:type": [staticEnumProvider(LAYER_ATTACHMENT_TYPES)],
  "layer publish:org": [completeCatalogOrgs],
  "add:layer": [completeLocalLayers],
  "add:create-layer": [completeLocalLayers],
  "add:harness": [completeHarnessSlugs],
  "add:project": [completeDirectoryPath],
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

const LAYER_ACCOUNT_FLAGS = new Set(["account"]);

function positionalKey(commandPath: string[], index: number): string {
  return `${commandPath.join(" ")}:${index}`;
}

function flagKey(commandPath: string[], flag: string): string {
  return `${commandPath.join(" ")}:${flag}`;
}

function resolveLayerWildcardProviders(
  ctx: CompletionContext,
  slot: "flag-value" | "positional",
): CompletionProvider[] {
  if (!ctx.commandPath[0] || ctx.commandPath[0] !== "layer") {
    return [];
  }

  if (slot === "flag-value" && ctx.flag && LAYER_ACCOUNT_FLAGS.has(ctx.flag)) {
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

    providers.push(...resolveLayerWildcardProviders(ctx, "flag-value"));

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
    providers.push(...resolveLayerWildcardProviders(ctx, "positional"));
  }

  return providers;
}
