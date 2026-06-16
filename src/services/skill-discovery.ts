import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import matter from "gray-matter";

export interface DiscoveredSkill {
  name: string;
  description: string;
  category: string;
  skillDirRelative: string;
  skillMdRelative: string;
}

const SKILL_ROOTS = ["skills", ".agents/skills"] as const;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSkillMd(skillDir: string): { name: string; description: string; body: string } | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  const raw = readFileSync(skillPath, "utf-8");
  const parsed = matter(raw);
  const dirName = skillDir.split(/[/\\]/).pop() ?? "skill";
  return {
    name:
      typeof parsed.data.name === "string" && parsed.data.name.trim()
        ? parsed.data.name.trim()
        : dirName,
    description: typeof parsed.data.description === "string" ? parsed.data.description : "",
    body: parsed.content,
  };
}

function walkForSkills(rootPath: string, currentDir: string, results: DiscoveredSkill[]): void {
  if (!isDirectory(currentDir)) return;

  const skill = readSkillMd(currentDir);
  if (skill) {
    const skillDirRelative = relative(rootPath, currentDir).split("\\").join("/");
    const parts = skillDirRelative.split("/");
    const category =
      parts.length >= 3 && parts[0] === "skills" ? (parts[1] ?? "general") : "general";
    results.push({
      name: skill.name,
      description: skill.description,
      category,
      skillDirRelative,
      skillMdRelative: `${skillDirRelative}/SKILL.md`,
    });
    return;
  }

  for (const entry of readdirSync(currentDir)) {
    if (entry.startsWith(".")) continue;
    walkForSkills(rootPath, join(currentDir, entry), results);
  }
}

export function discoverSkillPackage(rootPath: string): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = [];
  for (const root of SKILL_ROOTS) {
    const dir = join(rootPath, root);
    if (!isDirectory(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      walkForSkills(rootPath, join(dir, entry), results);
    }
  }

  const byName = new Map<string, DiscoveredSkill>();
  for (const skill of results) {
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
