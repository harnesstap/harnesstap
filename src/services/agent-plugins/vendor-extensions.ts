import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import matter from "gray-matter";
import type { HookMetadata, Plugin, Resource } from "../../types.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { buildHooksJson } from "../hook-serialization.js";
import type { ApManifest } from "./manifest.js";

/**
 * Opt-in copy of agents, commands, and hooks into client namespaces.
 *
 * Copilot files follow the published layout: `com.github.copilot/agents/*.agent.md`,
 * `commands/*.md`, and `hooks/hooks.json`.
 * Codex documents hooks on `extensions.com.openai` (path relative to the plugin
 * root, starting with `./`). It does not document agents or commands there, so
 * those resources are not copied under `com.openai`.
 */

const COPILOT_NS = "com.github.copilot";
const OPENAI_NS = "com.openai";

export interface VendorExtensionFile {
  path: string;
  content: string;
}

export interface VendorExtensionPlan {
  files: VendorExtensionFile[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeStem(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  if (!cleaned || cleaned === "." || cleaned === "..") return "item";
  return cleaned;
}

function markdownFile(name: string, description: string, content: string): string {
  return matter.stringify(content, {
    name,
    ...(description ? { description } : {}),
  });
}

function outsidePackageToken(token: string): boolean {
  const bare = token.replace(/^['"]|['"]$/g, "");
  if (!bare || bare === "." || bare === "~") return bare === "~";
  if (bare.startsWith("~/")) return true;
  if (bare.startsWith("/") || /^[A-Za-z]:[\\/]/.test(bare)) return true;
  return bare.replaceAll("\\", "/").split("/").includes("..");
}

function expandUserPath(token: string, home: string): string {
  const bare = token.replace(/^['"]|['"]$/g, "");
  if (bare === "~") return home;
  if (bare.startsWith("~/")) return resolve(home, bare.slice(2));
  return bare;
}

function bundledRelativePath(
  files: VendorExtensionFile[],
  bundleDir: string,
  stem: string,
  content: string,
  hookName: string,
): string {
  const primary = `${bundleDir}/${stem}`;
  const existing = files.find((file) => file.path === primary);
  if (!existing) {
    files.push({ path: primary, content });
    return primary;
  }
  if (existing.content === content) return primary;
  const unique = `${bundleDir}/${stem}-${safeStem(hookName)}`;
  const collision = files.find((file) => file.path === unique);
  if (!collision) {
    files.push({ path: unique, content });
  }
  return unique;
}

/**
 * Copy a hook script that lives outside the package and point the command at
 * the copy. Returns undefined when an outside path cannot be read.
 */
function rewriteOutsideCommand(
  command: string,
  bundleDir: string,
  files: VendorExtensionFile[],
  warnings: string[],
  hookName: string,
  home: string,
): string | undefined {
  let dropped = false;
  const next = command.split(/(\s+)/).map((token) => {
    if (dropped || !outsidePackageToken(token)) return token;
    const bare = token.replace(/^['"]|['"]$/g, "");
    const absolute = expandUserPath(bare, home);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      warnings.push(
        `Skipped hook "${hookName}": ${bare} is outside the package and was not bundled.`,
      );
      dropped = true;
      return token;
    }
    const relative = bundledRelativePath(
      files,
      bundleDir,
      safeStem(basename(absolute)),
      readFileSync(absolute, "utf8"),
      hookName,
    );
    return `./${relative}`;
  });
  return dropped ? undefined : next.join("");
}

function rewriteHookEntryCommands(
  value: unknown,
  bundleDir: string,
  files: VendorExtensionFile[],
  warnings: string[],
  hookName: string,
  home: string,
): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const next = rewriteHookEntryCommands(item, bundleDir, files, warnings, hookName, home);
      if (next === undefined) return undefined;
      items.push(next);
    }
    return items;
  }
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "command" || key === "commandWindows") && typeof entry === "string") {
      const rewritten = rewriteOutsideCommand(
        entry,
        bundleDir,
        files,
        warnings,
        hookName,
        home,
      );
      if (rewritten === undefined) return undefined;
      next[key] = rewritten;
      continue;
    }
    const child = rewriteHookEntryCommands(entry, bundleDir, files, warnings, hookName, home);
    if (child === undefined && (isRecord(entry) || Array.isArray(entry))) return undefined;
    next[key] = child;
  }
  return next;
}

function bundleVendorHooks(
  hooks: Array<HookMetadata & { name?: string }>,
  bundleDir: string,
  files: VendorExtensionFile[],
  warnings: string[],
  home: string,
): Array<HookMetadata & { name?: string }> {
  const bundled: Array<HookMetadata & { name?: string }> = [];
  for (const hook of hooks) {
    const name = hook.name ?? hook.event;
    const before = warnings.length;
    const script = rewriteOutsideCommand(hook.script, bundleDir, files, warnings, name, home);
    if (script === undefined) continue;
    let hookEntry = hook.hook_entry;
    if (hookEntry) {
      const rewritten = rewriteHookEntryCommands(
        hookEntry,
        bundleDir,
        files,
        warnings,
        name,
        home,
      );
      if (!isRecord(rewritten)) {
        if (warnings.length === before) {
          warnings.push(
            `Skipped hook "${name}": a command points outside the package and was not bundled.`,
          );
        }
        continue;
      }
      hookEntry = rewritten;
    }
    bundled.push({
      ...hook,
      script,
      ...(hookEntry ? { hook_entry: hookEntry } : {}),
    });
  }
  return bundled;
}

function asHook(resource: Resource): HookMetadata | undefined {
  if (!isRecord(resource.metadata)) return undefined;
  const event = resource.metadata.event;
  const script = resource.metadata.script;
  if (typeof event !== "string" || event.length === 0) return undefined;
  if (typeof script !== "string" || script.length === 0) return undefined;
  return resource.metadata as unknown as HookMetadata;
}

function mergeObject(
  manifest: ApManifest,
  namespace: string,
  patch: Record<string, unknown>,
): void {
  const current = manifest.extensions?.[namespace];
  const base = isRecord(current) ? { ...current } : {};
  manifest.extensions = {
    ...(manifest.extensions ?? {}),
    [namespace]: { ...base, ...patch },
  };
}

/**
 * Adds Copilot files and Codex hook settings onto a package that is about to
 * be written. Existing paths are listed but the caller must not replace them.
 */
export function planVendorExtensions(
  plugin: Pick<Plugin, "name" | "description">,
  resources: readonly Resource[],
  manifest: ApManifest,
): VendorExtensionPlan {
  const warnings: string[] = [];
  const files: VendorExtensionFile[] = [];
  const agents = resources.filter((resource) => resource.type === "agent");
  const commands = resources.filter((resource) => resource.type === "command");
  const hooks = resources.filter((resource) => resource.type === "hook");

  for (const resource of [...agents].sort((a, b) => a.name.localeCompare(b.name))) {
    const stem = safeStem(resource.name);
    files.push({
      path: `${COPILOT_NS}/agents/${stem}.agent.md`,
      content: markdownFile(stem, resource.description, resource.content),
    });
  }
  for (const resource of [...commands].sort((a, b) => a.name.localeCompare(b.name))) {
    const stem = safeStem(resource.name);
    files.push({
      path: `${COPILOT_NS}/commands/${stem}.md`,
      content: markdownFile(stem, resource.description, resource.content),
    });
  }

  const hookMeta: Array<HookMetadata & { name?: string }> = [];
  for (const resource of hooks) {
    const hook = asHook(resource);
    if (!hook) {
      warnings.push(
        `hook "${resource.name}" was not copied into vendor namespaces because it has no event and script`,
      );
      continue;
    }
    hookMeta.push({ ...hook, name: resource.name });
  }
  if (hookMeta.length > 0) {
    const home = resolveHomeRoot();
    const copilotHooks = bundleVendorHooks(
      hookMeta,
      `${COPILOT_NS}/hooks`,
      files,
      warnings,
      home,
    );
    const openaiHooks = bundleVendorHooks(
      hookMeta,
      `${OPENAI_NS}/hooks`,
      files,
      warnings,
      home,
    );
    const copilotDocument = buildHooksJson(copilotHooks, {
      shape: "wrapped",
      includePluginRoot: true,
    });
    if (Object.keys(copilotDocument.hooks).length > 0) {
      files.push({
        path: `${COPILOT_NS}/hooks/hooks.json`,
        content: `${JSON.stringify(copilotDocument, null, 2)}\n`,
      });
    }
    const openai = manifest.extensions?.[OPENAI_NS];
    const openaiRecord = isRecord(openai) ? openai : {};
    const existingHooks = typeof openaiRecord.hooks === "string" ? openaiRecord.hooks : undefined;
    const openaiDocument = buildHooksJson(openaiHooks, {
      shape: "wrapped",
      includePluginRoot: true,
    });
    const openaiHasHooks = Object.keys(openaiDocument.hooks).length > 0;
    if (!existingHooks && openaiHasHooks) {
      files.push({
        path: `${OPENAI_NS}/hooks/hooks.json`,
        content: `${JSON.stringify(openaiDocument, null, 2)}\n`,
      });
    }
    if (Object.keys(copilotDocument.hooks).length > 0 || openaiHasHooks) {
      const interfaceRecord = isRecord(openaiRecord.interface) ? openaiRecord.interface : {};
      mergeObject(manifest, OPENAI_NS, {
        ...(!existingHooks && openaiHasHooks
          ? { hooks: "./com.openai/hooks/hooks.json" }
          : {}),
        interface: {
          ...interfaceRecord,
          ...(interfaceRecord.displayName ? {} : { displayName: plugin.name }),
          ...(interfaceRecord.shortDescription || !plugin.description
            ? {}
            : { shortDescription: plugin.description }),
        },
      });
    }
  }

  if (agents.length > 0 || commands.length > 0 || files.some((file) => file.path.startsWith(`${COPILOT_NS}/`))) {
    const current = manifest.extensions?.[COPILOT_NS];
    if (!isRecord(current)) {
      mergeObject(manifest, COPILOT_NS, {});
    }
  }

  if (agents.length > 0 || commands.length > 0) {
    warnings.push(
      "agents and commands were copied under com.github.copilot; Codex does not document those paths, so they were not copied under com.openai",
    );
  }

  const uniqueWarnings = [...new Set(warnings)];
  if (files.length === 0 && uniqueWarnings.length === 0) {
    return { files: [], warnings: [] };
  }
  return { files, warnings: uniqueWarnings };
}
