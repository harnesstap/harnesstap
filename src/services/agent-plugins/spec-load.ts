import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import semver from "semver";
import type { McpServerMetadata, ResourceCreateInput, SkillMetadata } from "../../types.js";
import { loadVerifiedPackageFiles } from "../apm-bundle.js";
import { parseTransportToml } from "../toml/read.js";
import type { ApPackageFile, ApPackageFiles } from "./files.js";
import { packageFileFromBytes } from "./files.js";
import type { ApManifest } from "./manifest.js";
import { HT_EXTENSION_NAMESPACE } from "./manifest.js";
import { isValidAgentSkillName } from "./name.js";
import { AP_MCP_SCHEMA_URL } from "./schema-registry.js";
import { HT_MCP_EXTRAS_PATH, isSpecMcpDocument, readApMcpServers } from "./spec-mcp.js";
import { parseSpecMcpJson } from "./spec-mcp-parse.js";
import {
  type ApManifestDiagnosis,
  diagnoseApManifest,
  withDefaultedApSchema,
} from "./validate.js";

export interface ApLoadSkipped {
  /** `rule` and `instruction` only come from an unsupported root directory. */
  component: "skill" | "mcp" | "rule" | "instruction";
  name: string;
  reason: string;
  /** Package-relative file the entry came from, when there is one. */
  path?: string;
}

export interface ApLoadReported {
  field: string;
  message: string;
}

export interface ApLoadReport {
  spec: "1.0.0";
  ok: boolean;
  rejected?: string;
  name?: string;
  /** Library version: the manifest version when it is semver, otherwise synthesized. */
  version?: string;
  declaredVersion?: string;
  loaded: {
    skills: string[];
    mcpServers: string[];
  };
  skipped: ApLoadSkipped[];
  reported: ApLoadReported[];
  mcpDisabled?: string;
}

export interface SpecPackageLoad {
  report: ApLoadReport;
  manifest: ApManifest | null;
  skills: ResourceCreateInput[];
  mcp: ResourceCreateInput[];
  /** com.harnesstap extension object, when it is an object. */
  extension: unknown;
}

export interface LoadSpecOptions {
  /** Directory the package was read from, for symlink containment. */
  root?: string;
}

const SKILL_PATH = /^skills\/([^/]+)\/SKILL\.md$/;

/**
 * Root directories authors reach for that are not in the Agent Plugins
 * layout. Their files are not imported, so the load names each one and
 * points at the location HarnessTap does read.
 */
const UNSUPPORTED_ROOT_DIRS: Record<
  string,
  { component: ApLoadSkipped["component"]; alternative: string }
> = {
  rules: { component: "rule", alternative: `move rules to ${HT_EXTENSION_NAMESPACE}/rules/` },
  instructions: {
    component: "instruction",
    alternative: `move instructions to ${HT_EXTENSION_NAMESPACE}/instructions/`,
  },
  "mcp-servers": { component: "mcp", alternative: "declare MCP servers in a root mcp.json" },
  mcp_servers: { component: "mcp", alternative: "declare MCP servers in a root mcp.json" },
};
const DESCRIPTION_MAX = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fileText(entry: ApPackageFile): string {
  return entry.encoding === "base64"
    ? Buffer.from(entry.content, "base64").toString("utf8")
    : entry.content;
}

function outside(rootReal: string, real: string): boolean {
  const rel = relative(rootReal, real);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * Read a plugin directory without following a symlink that leaves the root.
 * Those paths are omitted. Callers still validate command and cwd containment.
 */
export function readContainedPackageFiles(root: string): ApPackageFiles {
  const resolvedRoot = realpathSync(resolve(root));
  const files: ApPackageFiles = {};
  const visited = new Set<string>();

  const walk = (dir: string): void => {
    if (visited.has(dir)) return;
    visited.add(dir);
    const entries = readdirSync(dir, { withFileTypes: true })
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      let real: string;
      try {
        real = realpathSync(absolute);
      } catch {
        continue;
      }
      if (outside(resolvedRoot, real)) continue;
      if (statSync(real).isDirectory()) {
        walk(real);
        continue;
      }
      const relativePath = relative(resolvedRoot, absolute).split(sep).join("/");
      if (relativePath.split("/").includes("..")) continue;
      files[relativePath] = packageFileFromBytes(readFileSync(absolute));
    }
  };

  walk(resolvedRoot);
  return files;
}

function emptyReport(partial: Partial<ApLoadReport> & { ok: boolean }): ApLoadReport {
  return {
    spec: "1.0.0",
    loaded: { skills: [], mcpServers: [] },
    skipped: [],
    reported: [],
    ...partial,
  };
}

function libraryVersion(declared: unknown, pluginJsonText: string): string {
  if (typeof declared === "string" && semver.valid(declared)) return declared;
  const sha = createHash("sha256").update(pluginJsonText).digest("hex").slice(0, 12);
  return `0.0.0+ap.${sha}`;
}

function listSkillAux(
  files: ApPackageFiles,
  skillName: string,
  kind: "scripts" | "reference" | "references",
): string[] {
  const prefix = `skills/${skillName}/${kind}/`;
  const names: string[] = [];
  for (const relativePath of Object.keys(files)) {
    if (!relativePath.startsWith(prefix)) continue;
    const rest = relativePath.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    names.push(rest);
  }
  return names.sort();
}

function skillNamesFromExtension(extension: unknown): Record<string, string> {
  if (!isRecord(extension) || !isRecord(extension.skillNames)) return {};
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(extension.skillNames)) {
    if (typeof value === "string" && value.length > 0) names[key] = value;
  }
  return names;
}

function loadSkills(
  files: ApPackageFiles,
  extension: unknown,
): { resources: ResourceCreateInput[]; skipped: ApLoadSkipped[] } {
  const originalNames = skillNamesFromExtension(extension);
  const resources: ResourceCreateInput[] = [];
  const skipped: ApLoadSkipped[] = [];
  const skillPaths = Object.keys(files)
    .filter((path) => SKILL_PATH.test(path))
    .sort();

  for (const relativePath of skillPaths) {
    const dirName = SKILL_PATH.exec(relativePath)?.[1];
    const entry = dirName ? files[relativePath] : undefined;
    if (!dirName || !entry) continue;
    if (entry.encoding !== "utf8") {
      skipped.push({
        component: "skill",
        name: dirName,
        path: relativePath,
        reason: "SKILL.md is not UTF-8 text",
      });
      continue;
    }
    if (!hasFrontmatter(entry.content)) {
      skipped.push({
        component: "skill",
        name: dirName,
        path: relativePath,
        reason: "SKILL.md has no YAML frontmatter (expected name and description between --- lines)",
      });
      continue;
    }
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = parseFrontmatter(entry.content);
    } catch (error) {
      skipped.push({
        component: "skill",
        name: dirName,
        path: relativePath,
        reason: yamlErrorReason(error),
      });
      continue;
    }
    const data = isRecord(parsed.data) ? parsed.data : {};
    const frontName = typeof data.name === "string" ? data.name : "";
    if (!isValidAgentSkillName(frontName) || frontName !== dirName) {
      skipped.push({
        component: "skill",
        name: dirName,
        path: relativePath,
        reason: frontName
          ? `skill name "${frontName}" must match the directory and Agent Skills name rules`
          : "SKILL.md frontmatter has no name; it must match the directory",
      });
      continue;
    }
    const description = typeof data.description === "string" ? data.description : "";
    if (description.length === 0 || description.length > DESCRIPTION_MAX) {
      skipped.push({
        component: "skill",
        name: dirName,
        path: relativePath,
        reason: "skill description must be 1 to 1024 characters",
      });
      continue;
    }

    const scripts = listSkillAux(files, dirName, "scripts");
    const references = [
      ...listSkillAux(files, dirName, "reference"),
      ...listSkillAux(files, dirName, "references"),
    ]
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort();
    const companionPrefix = `skills/${dirName}/`;
    const companions = Object.keys(files)
      .filter((path) => path.startsWith(companionPrefix) && path !== `${companionPrefix}SKILL.md`)
      .map((path) => path.slice(companionPrefix.length))
      .filter((rest) => rest.length > 0 && !rest.split("/").some((segment) => segment.startsWith(".")))
      .sort();
    const metadata: SkillMetadata = {};
    if (scripts.length > 0) metadata.scripts = scripts;
    if (references.length > 0) metadata.references = references;
    if (companions.length > 0) metadata.companions = companions;

    resources.push({
      type: "skill",
      name: originalNames[dirName] ?? frontName,
      description,
      content: parsed.content,
      metadata,
      source: "ap-package",
    });
  }

  return { resources, skipped };
}

function hasFrontmatter(content: string): boolean {
  return /^\uFEFF?---[ \t]*\r?\n/.test(content);
}

/** js-yaml marks are 0-based within the frontmatter, which starts on line 1 (`---`). */
function yamlErrorReason(error: unknown): string {
  const base = "SKILL.md frontmatter is not valid YAML";
  if (!isRecord(error)) return base;
  const mark = isRecord(error.mark) ? error.mark : undefined;
  const reason = typeof error.reason === "string" ? error.reason : undefined;
  const line = typeof mark?.line === "number" ? mark.line + 1 : undefined;
  const column = typeof mark?.column === "number" ? mark.column + 1 : undefined;
  const where = line ? ` at line ${line}${column ? `, column ${column}` : ""}` : "";
  const hint = reason?.startsWith("incomplete explicit mapping pair")
    ? "; quote values that contain \": \""
    : "";
  return `${base}${where}${reason ? `: ${reason}` : ""}${hint}`;
}

function unsupportedRootFiles(files: ApPackageFiles): ApLoadSkipped[] {
  const skipped: ApLoadSkipped[] = [];
  for (const path of Object.keys(files).sort()) {
    const [head, ...rest] = path.split("/");
    if (!head || rest.length === 0) continue;
    const layout = Object.hasOwn(UNSUPPORTED_ROOT_DIRS, head) ? UNSUPPORTED_ROOT_DIRS[head] : undefined;
    if (!layout) continue;
    const base = rest[rest.length - 1] ?? path;
    if (base.startsWith(".")) continue;
    skipped.push({
      component: layout.component,
      name: base.replace(/\.(md|mdc|json)$/i, ""),
      path,
      reason: `root ${head}/ is not part of the Agent Plugins layout and is not imported; ${layout.alternative}`,
    });
  }
  return skipped;
}

function locationNotes(root: string | undefined): ApLoadReported[] {
  if (!root) return [];
  const notes: ApLoadReported[] = [];
  const skillsPath = join(root, "skills");
  try {
    if (lstatSync(skillsPath).isSymbolicLink() === false && statSync(skillsPath).isFile()) {
      notes.push({ field: "skills", message: "skills is not a directory; no skills were loaded" });
    }
  } catch {
    // Missing skills/ is not an error.
  }
  const mcpPath = join(root, "mcp.json");
  try {
    const stat = statSync(mcpPath);
    if (!stat.isFile()) {
      notes.push({ field: "mcp.json", message: "mcp.json is not a file; MCP is disabled" });
    }
  } catch {
    // Missing mcp.json is not an error.
  }
  return notes;
}

function extrasServers(document: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!document || !isRecord(document.servers)) return {};
  return document.servers;
}

function mergeExtra(
  base: McpServerMetadata | undefined,
  rawExtra: unknown,
): McpServerMetadata | undefined {
  if (!isRecord(rawExtra)) return base;
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(rawExtra)) {
    if ((key === "env" || key === "headers") && isRecord(value)) {
      const prior = merged[key];
      merged[key] = { ...(isRecord(prior) ? prior : {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  if (merged.transport !== "stdio" && merged.transport !== "http") {
    merged.transport = typeof merged.url === "string" ? "http" : "stdio";
  }
  return merged as unknown as McpServerMetadata;
}

function loadMcp(
  files: ApPackageFiles,
  root: string | undefined,
): { resources: ResourceCreateInput[]; skipped: ApLoadSkipped[]; disabled?: string } {
  const entry = files["mcp.json"];
  if (!entry) return { resources: [], skipped: [] };
  let document: unknown;
  try {
    document = JSON.parse(fileText(entry)) as unknown;
  } catch {
    return { resources: [], skipped: [], disabled: "mcp.json is not valid JSON" };
  }

  const extrasEntry = files[HT_MCP_EXTRAS_PATH];
  let extras: Record<string, unknown> | undefined;
  if (extrasEntry) {
    try {
      extras = parseTransportToml(fileText(extrasEntry), "MCP extension");
    } catch {
      extras = undefined;
    }
  }

  if (!isRecord(document) || !isSpecMcpDocument(document)) {
    return { resources: mcpResources(readApMcpServers(document, extras)), skipped: [] };
  }

  const parsed = parseSpecMcpJson(document, { root, expectedSchema: AP_MCP_SCHEMA_URL });
  if (parsed.disabled) {
    return { resources: [], skipped: [], disabled: parsed.disabled };
  }

  const declared = new Set(
    Object.keys(isRecord(document.mcpServers) ? document.mcpServers : {}),
  );
  const skippedNames = new Set(parsed.skipped.map((item) => item.name));
  const servers: Record<string, McpServerMetadata> = {};
  for (const server of parsed.servers) servers[server.name] = server.metadata;
  for (const [name, rawExtra] of Object.entries(extrasServers(extras))) {
    if (skippedNames.has(name)) continue;
    if (declared.has(name) && !servers[name]) continue;
    const merged = mergeExtra(servers[name], rawExtra);
    if (merged) servers[name] = merged;
  }

  return {
    resources: mcpResources(servers),
    skipped: parsed.skipped.map((item) => ({
      component: "mcp" as const,
      name: item.name,
      path: "mcp.json",
      reason: item.reason,
    })),
  };
}

function mcpResources(servers: Record<string, McpServerMetadata>): ResourceCreateInput[] {
  return Object.keys(servers)
    .sort()
    .map((name) => {
      const metadata = servers[name];
      return {
        type: "mcp_server" as const,
        name,
        description: "",
        content: "",
        metadata: metadata ?? { transport: "stdio" as const },
        source: "ap-package",
      };
    });
}

export function loadSpecPackage(files: ApPackageFiles, options?: LoadSpecOptions): SpecPackageLoad {
  const manifestEntry = files["plugin.json"];
  if (!manifestEntry) {
    return {
      report: emptyReport({ ok: false, rejected: "Missing plugin.json: not an Agent Plugins package" }),
      manifest: null,
      skills: [],
      mcp: [],
      extension: undefined,
    };
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fileText(manifestEntry)) as unknown;
  } catch {
    return {
      report: emptyReport({ ok: false, rejected: "Invalid plugin.json: expected JSON" }),
      manifest: null,
      skills: [],
      mcp: [],
      extension: undefined,
    };
  }

  const { manifest: withSchema } = withDefaultedApSchema(manifestRaw);
  const diagnosis: ApManifestDiagnosis = diagnoseApManifest(withSchema, "import");
  const reported: ApLoadReported[] = [
    ...diagnosis.reported.map((message) => ({ field: reportedField(message), message })),
    ...locationNotes(options?.root),
  ];
  if (!diagnosis.manifest) {
    return {
      report: emptyReport({
        ok: false,
        rejected: diagnosis.fatal.join("; "),
        reported,
      }),
      manifest: null,
      skills: [],
      mcp: [],
      extension: undefined,
    };
  }

  const document = diagnosis.manifest;
  const extension = isRecord(document.extensions)
    ? document.extensions[HT_EXTENSION_NAMESPACE]
    : undefined;
  const declaredVersion = typeof document.version === "string" ? document.version : undefined;
  const version = libraryVersion(declaredVersion, fileText(manifestEntry));
  const manifest = { ...document, version } as ApManifest;

  const skills = loadSkills(files, extension);
  const mcp = loadMcp(files, options?.root);
  if (mcp.disabled) {
    reported.push({ field: "mcp.json", message: mcp.disabled });
  }

  const loadedSkills = skills.resources.map((resource) => resource.name);
  const loadedMcp = mcp.resources.map((resource) => resource.name);

  return {
    report: {
      spec: "1.0.0",
      ok: true,
      name: manifest.name,
      version,
      ...(declaredVersion && declaredVersion !== version ? { declaredVersion } : {}),
      loaded: { skills: loadedSkills, mcpServers: loadedMcp },
      skipped: [...skills.skipped, ...mcp.skipped, ...unsupportedRootFiles(files)],
      reported,
      ...(mcp.disabled ? { mcpDisabled: mcp.disabled } : {}),
    },
    manifest,
    skills: skills.resources,
    mcp: mcp.resources,
    extension,
  };
}

function reportedField(message: string): string {
  const unknown = /^unknown top-level field "([^"]+)"/.exec(message);
  if (unknown?.[1]) return unknown[1];
  if (message.startsWith("extensions")) return "extensions";
  return "plugin.json";
}

export function loadSpecPackagePath(filePath: string, specVersion = "1.0.0"): ApLoadReport {
  if (specVersion !== "1.0.0") {
    return emptyReport({
      ok: false,
      rejected: `unsupported Agent Plugins version ${specVersion} (this HarnessTap version reads 1.0.0)`,
    });
  }
  const resolved = resolve(filePath);
  try {
    if (statSync(resolved).isDirectory()) {
      return loadSpecPackage(readContainedPackageFiles(resolved), { root: resolved }).report;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return emptyReport({
        ok: false,
        rejected: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    return loadSpecPackage(loadVerifiedPackageFiles(resolved)).report;
  } catch (error) {
    return emptyReport({
      ok: false,
      rejected: error instanceof Error ? error.message : String(error),
    });
  }
}
