import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SerializedFile } from "../types.js";

export function listRelativeFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    if (!statSync(dirPath).isDirectory()) return [];
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dirPath)) {
    if (entry.startsWith(".")) continue;
    const entryPath = join(dirPath, entry);
    try {
      if (statSync(entryPath).isFile()) {
        files.push(entry);
      }
    } catch {
    }
  }
  return files.sort();
}

export function listSkillAuxiliaryFiles(skillDir: string): {
  scripts: string[];
  references: string[];
} {
  const scripts = listRelativeFiles(join(skillDir, "scripts"));
  const references = listRelativeFiles(join(skillDir, "reference"))
    .concat(listRelativeFiles(join(skillDir, "references")))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
  return { scripts, references };
}

function resolveReferenceSourcePath(
  sourceSkillDir: string,
  name: string,
): string | undefined {
  for (const subdir of ["reference", "references"] as const) {
    const candidate = join(sourceSkillDir, subdir, name);
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
      }
    }
  }
  return undefined;
}

export function emitSkillAuxiliaryFiles(input: {
  sourceSkillDir: string;
  targetPrefix: string;
  scripts: string[];
  references: string[];
}): SerializedFile[] {
  const files: SerializedFile[] = [];
  const normalizedPrefix = input.targetPrefix.replace(/\/$/, "");

  for (const name of input.scripts) {
    const sourcePath = join(input.sourceSkillDir, "scripts", name);
    if (!existsSync(sourcePath)) continue;
    files.push({
      path: `${normalizedPrefix}/scripts/${name}`,
      content: readFileSync(sourcePath, "utf-8"),
    });
  }

  for (const name of input.references) {
    const sourcePath = resolveReferenceSourcePath(input.sourceSkillDir, name);
    if (!sourcePath) continue;
    files.push({
      path: `${normalizedPrefix}/reference/${name}`,
      content: readFileSync(sourcePath, "utf-8"),
    });
  }

  return files;
}
