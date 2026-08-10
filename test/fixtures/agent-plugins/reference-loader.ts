import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface LoadedPlugin {
  name: string;
  version: string;
  skills: Array<{ name: string; description: string; body: string }>;
  mcpServers: Record<string, unknown>;
}

/**
 * A deliberately naive Agent Plugins 1.0 consumer. It knows nothing about
 * HarnessTap and must ignore `extensions` and any `com.harnesstap/` directory.
 */
export function loadAgentPlugin(root: string): LoadedPlugin {
  const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")) as {
    name: string;
    version: string;
  };

  const skills: LoadedPlugin["skills"] = [];
  const skillsDir = join(root, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(file)) continue;
      const raw = readFileSync(file, "utf8");
      const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
      if (!match) throw new Error(`SKILL.md has no frontmatter: ${file}`);
      const [, frontmatter = "", body = ""] = match;
      const fields = Object.fromEntries(
        frontmatter
          .split("\n")
          .map((line) => line.split(/:\s*/))
          .filter((parts): parts is [string, string] => parts.length === 2),
      );
      skills.push({
        name: fields.name ?? entry.name,
        description: fields.description ?? "",
        body: body.trim(),
      });
    }
  }

  const mcpPath = join(root, "mcp.json");
  const mcpServers = existsSync(mcpPath)
    ? ((JSON.parse(readFileSync(mcpPath, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      }).mcpServers ?? {})
    : {};

  return { name: manifest.name, version: manifest.version, skills, mcpServers };
}
