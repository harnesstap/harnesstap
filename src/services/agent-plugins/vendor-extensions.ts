import matter from "gray-matter";
import type { HookMetadata, Plugin, Resource } from "../../types.js";
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
    const document = buildHooksJson(hookMeta, {
      shape: "wrapped",
      includePluginRoot: true,
    });
    if (Object.keys(document.hooks).length > 0) {
      const body = `${JSON.stringify(document, null, 2)}\n`;
      files.push({ path: `${COPILOT_NS}/hooks/hooks.json`, content: body });
      const openai = manifest.extensions?.[OPENAI_NS];
      const openaiRecord = isRecord(openai) ? openai : {};
      const existingHooks = typeof openaiRecord.hooks === "string" ? openaiRecord.hooks : undefined;
      if (!existingHooks) {
        files.push({ path: `${OPENAI_NS}/hooks/hooks.json`, content: body });
      }
      const interfaceRecord = isRecord(openaiRecord.interface) ? openaiRecord.interface : {};
      mergeObject(manifest, OPENAI_NS, {
        ...(existingHooks ? {} : { hooks: "./com.openai/hooks/hooks.json" }),
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

  if (files.length === 0 && warnings.length === 0) {
    return { files: [], warnings: [] };
  }
  return { files, warnings };
}
