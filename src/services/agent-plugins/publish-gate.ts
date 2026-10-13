import type { ApPackageFile, ApPackageFiles } from "./files.js";
import { parseSpecMcpJson } from "./spec-mcp-parse.js";
import { diagnoseApManifest } from "./validate.js";

/**
 * Publish check for an Agent Plugins 1.0.0 package.
 *
 * A manifest that fails strict diagnosis, including a `$schema` that is not
 * the 1.0.0 identifier, always blocks. An `mcp.json` the spec loader would
 * disable always blocks. Skill renames, secret moves, and skipped servers
 * block only when `strict` is set.
 */
export class SpecPublishError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.name = "SpecPublishError";
    this.problems = problems;
  }
}

function fileText(entry: ApPackageFile): string {
  return entry.encoding === "base64"
    ? Buffer.from(entry.content, "base64").toString("utf8")
    : entry.content;
}

export function assertAgentPluginsPublishable(
  files: ApPackageFiles,
  opts?: { strict?: boolean; warnings?: string[] },
): string[] {
  const warnings = opts?.warnings ?? [];
  const pluginFile = files["plugin.json"];
  if (!pluginFile) {
    throw new SpecPublishError(["plugin.json is required"]);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(fileText(pluginFile)) as unknown;
  } catch {
    throw new SpecPublishError(["plugin.json is not valid JSON"]);
  }
  const diagnosis = diagnoseApManifest(manifest, "strict");
  if (diagnosis.fatal.length > 0 || diagnosis.manifest === null) {
    throw new SpecPublishError(
      diagnosis.fatal.length > 0 ? diagnosis.fatal : ["plugin.json is not a valid Agent Plugins manifest"],
    );
  }

  const mcpFile = files["mcp.json"];
  if (mcpFile) {
    let document: unknown;
    try {
      document = JSON.parse(fileText(mcpFile)) as unknown;
    } catch {
      throw new SpecPublishError(["mcp.json is not valid JSON"]);
    }
    const parsed = parseSpecMcpJson(document);
    if (parsed.disabled) {
      throw new SpecPublishError([`mcp.json is invalid: ${parsed.disabled}`]);
    }
    for (const skipped of parsed.skipped) {
      warnings.push(`mcp.json server "${skipped.name}" was skipped: ${skipped.reason}`);
    }
  }

  if (opts?.strict === true && warnings.length > 0) {
    throw new SpecPublishError(warnings);
  }
  return warnings;
}
