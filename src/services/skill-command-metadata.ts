import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type {
  ImportedResourceProvenance,
  ResourceCreateInput,
} from "../types.js";

const COMMAND_METADATA_FILE = join("scripts", "command-metadata.json");

interface SkillCommandMetadataEntry {
  description?: string;
  argumentHint?: string;
}

type SkillCommandMetadataFile = Record<string, SkillCommandMetadataEntry>;

function readText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function parseCommandMetadata(
  filePath: string,
  raw: string,
): SkillCommandMetadataFile {
  try {
    const parsed = JSON.parse(raw) as SkillCommandMetadataFile;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected object");
    }
    return parsed;
  } catch {
    throw new Error(`Malformed skill command metadata: ${filePath}`);
  }
}

function readReferenceContent(skillDir: string, commandKey: string): string | undefined {
  for (const referenceDir of ["reference", "references"]) {
    const referencePath = join(skillDir, referenceDir, `${commandKey}.md`);
    const raw = readText(referencePath);
    if (!raw) continue;

    if (raw.startsWith("---")) {
      try {
        const parsed = matter(raw);
        if (parsed.content === raw) {
          throw new Error("unclosed frontmatter");
        }
        return parsed.content.trim();
      } catch {
        throw new Error(`Malformed reference frontmatter: ${referencePath}`);
      }
    }

    return raw.trim();
  }

  return undefined;
}

function buildFallbackCommandContent(
  skillName: string,
  commandKey: string,
  entry: SkillCommandMetadataEntry,
): string {
  const description =
    typeof entry.description === "string" ? entry.description.trim() : "";
  const lines = [`# ${skillName} ${commandKey}`, ""];
  if (description.length > 0) {
    lines.push(description, "");
  }
  lines.push(
    `Use the ${skillName} skill. Read reference/${commandKey}.md for the full command flow.`,
  );
  return lines.join("\n");
}

function assertSafeCommandName(name: string, filePath: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    throw new Error(`Invalid command name in ${filePath}: ${name}`);
  }
  return trimmed;
}

export interface ScanSkillCommandMetadataInput {
  skillDir: string;
  skillName: string;
  rootPath: string;
  relativePath: (rootPath: string, filePath: string) => string;
  importedFrom?: ImportedResourceProvenance;
}

export function scanSkillCommandMetadataResources(
  input: ScanSkillCommandMetadataInput,
): ResourceCreateInput[] {
  const metadataPath = join(input.skillDir, COMMAND_METADATA_FILE);
  if (!existsSync(metadataPath)) return [];

  const raw = readText(metadataPath);
  if (!raw) return [];

  const metadataFile = parseCommandMetadata(metadataPath, raw);
  const resources: ResourceCreateInput[] = [];

  for (const [commandKey, entry] of Object.entries(metadataFile)) {
    if (!entry || typeof entry !== "object") continue;

    const referenceContent = readReferenceContent(input.skillDir, commandKey);
    const description =
      typeof entry.description === "string" ? entry.description.trim() : "";
    const argumentHint =
      typeof entry.argumentHint === "string" ? entry.argumentHint.trim() : "";
    const commandName = assertSafeCommandName(
      `${input.skillName}:${commandKey}`,
      metadataPath,
    );
    const source = input.importedFrom
      ? input.importedFrom.relative_path
      : input.relativePath(input.rootPath, metadataPath);

    const commandMetadata: Record<string, unknown> = {
      skill_command: true,
      skill_name: input.skillName,
      command_key: commandKey,
    };
    if (argumentHint.length > 0) {
      commandMetadata.argument_hint = argumentHint;
    }
    if (input.importedFrom) {
      commandMetadata.imported_from = input.importedFrom;
    }

    resources.push({
      type: "command",
      name: commandName,
      description,
      content:
        referenceContent ??
        buildFallbackCommandContent(input.skillName, commandKey, entry),
      source,
      metadata: commandMetadata,
    });
  }

  return resources.sort((a, b) => a.name.localeCompare(b.name));
}
