import type { CompletionContext, CompletionProvider } from "./types.js";
import { completeCloudProfiles } from "./providers/cloud-profile.js";
import {
  completeDirectoryPath,
  completeFilePath,
  completeLayerImportPath,
} from "./providers/file-path.js";
import { completeHarnessSlugs } from "./providers/harness-slug.js";
import { completeLocalDecks } from "./providers/local-deck.js";
import { completeLocalLayers } from "./providers/local-layer.js";
import { staticEnumProvider } from "./providers/static-enum.js";
import { flagsMatch } from "./utils.js";

type PositionalRegistry = Record<string, CompletionProvider[]>;
type FlagRegistry = Record<string, CompletionProvider[]>;

const POSITIONAL_PROVIDERS: PositionalRegistry = {
  "layer show:0": [completeLocalLayers],
  "layer delete:0": [completeLocalLayers],
  "layer export:0": [completeLocalLayers],
  "layer apply:0": [completeLocalLayers],
  "layer combine:0": [completeLocalLayers],
  "layer uncombine:0": [completeLocalLayers],
  "layer publish:0": [completeLocalLayers],
  "layer set-environment:0": [completeLocalLayers],
  "layer unset-environment:0": [completeLocalLayers],
  "layer diff:0": [completeLocalLayers],
  "layer diff:1": [completeLocalLayers],
  "deck show:0": [completeLocalDecks],
  "deck delete:0": [completeLocalDecks],
  "deck export:0": [completeLocalDecks],
  "deck apply:0": [completeLocalDecks],
  "project apply:0": [completeLocalLayers],
  "auth login:0": [completeCloudProfiles],
  "layer import:0": [completeLayerImportPath],
  "deck import:0": [completeDirectoryPath],
};

const FLAG_PROVIDERS: FlagRegistry = {
  "init:main": [completeHarnessSlugs],
  "init:aliases": [completeHarnessSlugs],
  "harness set:main": [completeHarnessSlugs],
  "harness set:aliases": [completeHarnessSlugs],
  "harness project set:main": [completeHarnessSlugs],
  "harness project set:aliases": [completeHarnessSlugs],
  "layer export:file": [completeFilePath],
  "project apply:project": [completeDirectoryPath],
  "add:layer": [completeLocalLayers],
  "add:create-layer": [completeLocalLayers],
  "add:harness": [completeHarnessSlugs],
  "add:project": [completeDirectoryPath],
  "auth status:profile": [completeCloudProfiles],
  "auth logout:profile": [completeCloudProfiles],
  "auth orgs:profile": [completeCloudProfiles],
};

const GLOBAL_FLAG_PROVIDERS: Record<string, CompletionProvider[]> = {
  format: [staticEnumProvider(["human", "json"])],
  harness: [completeHarnessSlugs],
  h: [completeHarnessSlugs],
  profile: [completeCloudProfiles],
};

const LAYER_PROFILE_FLAGS = new Set(["profile"]);

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

  if (slot === "flag-value" && ctx.flag && LAYER_PROFILE_FLAGS.has(ctx.flag)) {
    return [completeCloudProfiles];
  }

  return [];
}

export function lookupProviders(ctx: CompletionContext): CompletionProvider[] {
  const providers: CompletionProvider[] = [];

  if (ctx.slot === "flag-value" && ctx.flag) {
    const normalizedFlag = ctx.flag;
    const specific = FLAG_PROVIDERS[flagKey(ctx.commandPath, normalizedFlag)];
    if (specific) {
      providers.push(...specific);
    }

    const global = GLOBAL_FLAG_PROVIDERS[normalizedFlag];
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
