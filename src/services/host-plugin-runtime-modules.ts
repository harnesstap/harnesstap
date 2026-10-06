import { posix } from "node:path";

const MODULE_EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i;
const DROP = Symbol("drop");

const PLUGIN_MANIFEST_PATHS = new Set([
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
]);

export interface HostPluginTreeFile {
  relativePath: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface FilterHostPluginRuntimeFilesResult {
  files: HostPluginTreeFile[];
  skippedModules: string[];
}

function hasRuntimeModuleExtension(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return MODULE_EXT.test(normalized.split("/").pop() ?? "");
}

export function filterHostPluginRuntimeFiles(
  files: readonly HostPluginTreeFile[],
  allowRuntimeModules: boolean,
): FilterHostPluginRuntimeFilesResult {
  if (allowRuntimeModules) {
    return { files: [...files], skippedModules: [] };
  }

  const modulePaths = new Set<string>();
  let hooksDirHasModule = false;

  for (const file of files) {
    const path = posixPath(file.relativePath);
    if (isUnderHooksDir(path) && hasRuntimeModuleExtension(path)) {
      modulePaths.add(path);
      hooksDirHasModule = true;
    }
  }

  for (const file of files) {
    if (file.encoding === "base64") continue;
    const path = posixPath(file.relativePath);
    collectModulePathsFromJsonFile(file.content, path, modulePaths);
  }

  const skippedModules = new Set<string>();
  const nextFiles: HostPluginTreeFile[] = [];

  for (const file of files) {
    const path = posixPath(file.relativePath);
    if (
      modulePaths.has(path) ||
      (isUnderHooksDir(path) && hasRuntimeModuleExtension(path))
    ) {
      skippedModules.add(path);
      continue;
    }

    if (file.encoding === "base64" || !isLoaderJsonPath(path)) {
      nextFiles.push(file);
      continue;
    }

    const rewritten = rewriteLoaderJson(file.content, hooksDirHasModule);
    if (rewritten === undefined) {
      continue;
    }
    nextFiles.push({
      relativePath: file.relativePath,
      content: rewritten,
    });
  }

  return {
    files: nextFiles,
    skippedModules: [...skippedModules].sort(),
  };
}

function posixPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function isLoaderJsonPath(path: string): boolean {
  return path === "hooks.json" || path.endsWith("/hooks.json");
}

function isUnderHooksDir(path: string): boolean {
  return path === "hooks" || path.startsWith("hooks/");
}

function isModuleRefString(value: string): boolean {
  const normalized = posixPath(value);
  if (/[\s*?]/.test(normalized)) {
    return false;
  }
  if (!/^(?:\.\.\/|\.\/)*(?:[^/]+\/)*[^/]+$/.test(normalized)) {
    return false;
  }
  return MODULE_EXT.test(normalized.split("/").pop() ?? "");
}

function resolveModuleRef(jsonPath: string, ref: string): string {
  const stripped = posixPath(ref).replace(/^\.\//, "");
  const dir = posix.dirname(jsonPath);
  if (dir === "." || dir === "") {
    return posix.normalize(stripped);
  }
  return posix.normalize(posix.join(dir, stripped));
}

function resolveFromPluginRoot(ref: string): string {
  return posix.normalize(posixPath(ref).replace(/^\.\//, ""));
}

function collectModulePathsFromJsonFile(
  content: string,
  jsonPath: string,
  modulePaths: Set<string>,
): void {
  const isLoader = isLoaderJsonPath(jsonPath);
  const isManifest = PLUGIN_MANIFEST_PATHS.has(jsonPath);
  if (!isLoader && !isManifest) {
    return;
  }

  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return;
  }

  if (isLoader) {
    walkModuleRefs(doc, jsonPath, modulePaths);
  }

  if (
    isManifest &&
    doc &&
    typeof doc === "object" &&
    !Array.isArray(doc)
  ) {
    const hooks = (doc as Record<string, unknown>).hooks;
    if (typeof hooks === "string" && isModuleRefString(hooks)) {
      modulePaths.add(resolveFromPluginRoot(hooks));
    }
  }
}

function walkModuleRefs(
  value: unknown,
  jsonPath: string,
  modulePaths: Set<string>,
): void {
  if (typeof value === "string") {
    if (isModuleRefString(value)) {
      modulePaths.add(resolveModuleRef(jsonPath, value));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkModuleRefs(item, jsonPath, modulePaths);
    }
    return;
  }
  if (value && typeof value === "object") {
    if (isDeclarativeHookObject(value)) {
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      walkModuleRefs(child, jsonPath, modulePaths);
    }
  }
}

function rewriteLoaderJson(
  content: string,
  hooksDirHasModule: boolean,
): string | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return hooksDirHasModule ? undefined : content;
  }

  const state = { stripped: false };
  const rewritten = rewriteValue(doc, state);
  if (!state.stripped) {
    return content;
  }
  if (rewritten === DROP || !hasRemainingHookEntries(rewritten)) {
    return undefined;
  }
  return `${JSON.stringify(rewritten, null, 2)}\n`;
}

function hasRemainingHookEntries(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const hooks = (value as Record<string, unknown>).hooks;
  if (typeof hooks === "string") {
    return hooks.length > 0;
  }
  if (Array.isArray(hooks)) {
    return hooks.length > 0;
  }
  if (hooks && typeof hooks === "object") {
    return Object.keys(hooks).length > 0;
  }
  return false;
}

function isDeclarativeHookObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.command === "string" ||
    typeof record.url === "string" ||
    typeof record.prompt === "string"
  );
}

function rewriteValue(
  value: unknown,
  state: { stripped: boolean },
): unknown {
  if (typeof value === "string") {
    if (isModuleRefString(value)) {
      state.stripped = true;
      return DROP;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const next = value
      .map((item) => rewriteValue(item, state))
      .filter((item) => item !== DROP);
    return next.length === 0 ? DROP : next;
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  if (isDeclarativeHookObject(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const hadHooks = Object.hasOwn(record, "hooks");
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const rewritten = rewriteValue(child, state);
    if (rewritten !== DROP) {
      next[key] = rewritten;
    }
  }

  if (hadHooks && !Object.hasOwn(next, "hooks")) {
    return DROP;
  }

  return Object.keys(next).length === 0 ? DROP : next;
}
