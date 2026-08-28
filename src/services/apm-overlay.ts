import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import matter from "gray-matter";

export interface ApmOverlaySkill {
  name: string;
  description: string;
  content: string;
  skillDirRelative: string;
  skillMdRelative: string;
}

export interface ApmOverlayInfo {
  present: boolean;
  skills: ApmOverlaySkill[];
  skippedKinds: string[];
  warnings: string[];
}

const APM_PRIMITIVE_DIRS = [
  "skills",
  "instructions",
  "prompts",
  "agents",
  "chatmodes",
  "hooks",
  "mcp",
  "commands",
] as const;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkSkills(rootPath: string, currentDir: string, results: ApmOverlaySkill[]): void {
  if (!isDirectory(currentDir)) {
    return;
  }

  const skillPath = join(currentDir, "SKILL.md");
  if (existsSync(skillPath)) {
    const raw = readFileSync(skillPath, "utf-8");
    const parsed = matter(raw);
    const dirName = currentDir.split(/[/\\]/).pop() ?? "skill";
    const skillDirRelative = relative(rootPath, currentDir).split("\\").join("/");
    results.push({
      name:
        typeof parsed.data.name === "string" && parsed.data.name.trim()
          ? parsed.data.name.trim()
          : dirName,
      description: typeof parsed.data.description === "string" ? parsed.data.description : "",
      content: parsed.content.trim(),
      skillDirRelative,
      skillMdRelative: `${skillDirRelative}/SKILL.md`,
    });
    return;
  }

  for (const entry of readdirSync(currentDir)) {
    if (entry.startsWith(".")) {
      continue;
    }
    walkSkills(rootPath, join(currentDir, entry), results);
  }
}

export function inspectApmOverlay(rootPath: string): ApmOverlayInfo | undefined {
  const apmDir = join(rootPath, ".apm");
  if (!isDirectory(apmDir)) {
    return undefined;
  }

  const skills: ApmOverlaySkill[] = [];
  const skillsDir = join(apmDir, "skills");
  if (isDirectory(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      if (entry.startsWith(".")) {
        continue;
      }
      walkSkills(rootPath, join(skillsDir, entry), skills);
    }
  }

  const skippedKinds: string[] = [];
  const warnings: string[] = [];
  for (const dir of APM_PRIMITIVE_DIRS) {
    if (dir === "skills") {
      continue;
    }
    if (isDirectory(join(apmDir, dir))) {
      skippedKinds.push(`.apm/${dir}`);
      warnings.push(
        `Local .apm/${dir} primitives are present but not yet applied; only .apm/skills (SKILL.md) are imported`,
      );
    }
  }

  if (skills.length === 0 && skippedKinds.length === 0) {
    warnings.push("Local .apm/ directory is present but contains no SKILL.md files to import");
  }

  return {
    present: true,
    skills,
    skippedKinds,
    warnings,
  };
}
