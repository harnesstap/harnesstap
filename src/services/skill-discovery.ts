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

function scalarString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseSkillFrontmatterFallback(raw: string): {
  data: Record<string, string>;
  content: string;
} {
  if (!raw.startsWith("---")) {
    return { data: {}, content: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, content: raw };
  }
  const data: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return {
    data,
    content: raw.slice(end + 4).replace(/^\n/, ""),
  };
}

function parseSkillMarkdown(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  try {
    const parsed = matter(raw);
    return { data: parsed.data as Record<string, unknown>, content: parsed.content };
  } catch {
    return parseSkillFrontmatterFallback(raw);
  }
}

function readSkillMd(skillDir: string): { name: string; description: string; body: string } | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(skillPath, "utf-8");
  } catch {
    return null;
  }
  const parsed = parseSkillMarkdown(raw);
  const dirName = skillDir.split(/[/\\]/).pop() ?? "skill";
  const name = scalarString(parsed.data.name);
  return {
    name: name || dirName,
    description: scalarString(parsed.data.description),
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
