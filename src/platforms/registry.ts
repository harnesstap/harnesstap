import type { PlatformDefinition, PlatformFeature } from "../types.js";

// ── Platform definitions ────────────────────────────────────────────────
// Each platform declares what features it supports and where files live.

function def(
  id: string,
  name: string,
  features: PlatformFeature[],
  projectPaths: PlatformDefinition["projectPaths"],
  globalPaths: PlatformDefinition["globalPaths"],
): PlatformDefinition {
  return {
    id,
    name,
    supports: new Set(features),
    projectPaths,
    globalPaths,
  };
}

const ALL: PlatformFeature[] = [
  "instructions",
  "skills",
  "rules",
  "mcp",
  "permissions",
  "hooks",
  "agents",
  "commands",
  "env_vars",
  "model_config",
];

const PLATFORMS: PlatformDefinition[] = [
  // ── Full-featured platforms ──────────────────────────────────────────
  def("claude-code", "Claude Code", ALL, {
    instructions: "CLAUDE.md",
    skills: ".claude/skills/",
    rules: ".claude/rules/",
    mcp: ".mcp.json",
    permissions: ".claude/settings.json",
    hooks: ".claude/settings.json",
    agents: ".claude/agents/",
    commands: ".claude/commands/",
    settings: ".claude/settings.json",
  }, {
    instructions: "~/.claude/CLAUDE.md",
    skills: "~/.claude/skills/",
    rules: "~/.claude/rules/",
    agents: "~/.claude/agents/",
    commands: "~/.claude/commands/",
    settings: "~/.claude/settings.json",
  }),

  def("codex", "Codex", [
    "instructions", "skills", "rules", "mcp", "permissions",
    "hooks", "agents", "env_vars", "model_config",
  ], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    mcp: ".codex/config.toml",
    permissions: ".codex/config.toml",
    hooks: ".codex/hooks.json",
    agents: ".codex/agents/",
    settings: ".codex/config.toml",
  }, {
    instructions: "~/.codex/AGENTS.md",
    skills: "~/.agents/skills/",
    settings: "~/.codex/config.toml",
    agents: "~/.codex/agents/",
  }),

  def("cursor", "Cursor", [
    "instructions", "skills", "rules", "mcp",
  ], {
    instructions: "AGENTS.md",
    rules: ".cursor/rules/",
    skills: ".agents/skills/",
  }, {
    rules: "~/.cursor/rules/",
    skills: "~/.cursor/skills/",
  }),

  // ── Platforms using .agents/ convention ──────────────────────────────
  def("warp", "Warp", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
  }, {
    skills: "~/.agents/skills/",
  }),

  def("opencode", "OpenCode", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
  }, {
    skills: "~/.config/opencode/skills/",
  }),

  def("github-copilot", "GitHub Copilot", ["instructions", "skills"], {
    instructions: ".github/copilot-instructions.md",
    skills: ".agents/skills/",
  }, {
    skills: "~/.copilot/skills/",
  }),

  def("windsurf", "Windsurf", ["instructions", "skills"], {
    instructions: ".windsurfrules",
    skills: ".agents/skills/",
  }, {
    skills: "~/.codeium/windsurf/skills/",
  }),

  // ── .agents/ convention platforms (skills + instructions) ───────────
  ...([
    ["amp", "Amp", ".agents/skills/", "~/.config/agents/skills/"],
    ["cline", "Cline", ".agents/skills/", "~/.agents/skills/"],
    ["continue", "Continue", ".continue/skills/", "~/.continue/skills/"],
    ["goose", "Goose", ".goose/skills/", "~/.config/goose/skills/"],
    ["roo", "Roo Code", ".roo/skills/", "~/.roo/skills/"],
    ["gemini-cli", "Gemini CLI", ".agents/skills/", "~/.gemini/skills/"],
    ["kilo", "Kilo Code", ".kilocode/skills/", "~/.kilocode/skills/"],
    ["augment", "Augment", ".augment/skills/", "~/.augment/skills/"],
    ["firebender", "Firebender", ".agents/skills/", "~/.firebender/skills/"],
    ["trae", "Trae", ".trae/skills/", "~/.trae/skills/"],
    ["junie", "Junie", ".junie/skills/", "~/.junie/skills/"],
    ["zencoder", "Zencoder", ".zencoder/skills/", "~/.zencoder/skills/"],
    ["openhands", "OpenHands", ".openhands/skills/", "~/.openhands/skills/"],
    ["deepagents", "Deep Agents", ".agents/skills/", "~/.deepagents/agent/skills/"],
    ["qwen-code", "Qwen Code", ".qwen/skills/", "~/.qwen/skills/"],
    ["crush", "Crush", ".crush/skills/", "~/.config/crush/skills/"],
    ["droid", "Droid", ".factory/skills/", "~/.factory/skills/"],
    ["codebuddy", "CodeBuddy", ".codebuddy/skills/", "~/.codebuddy/skills/"],
    ["mux", "Mux", ".mux/skills/", "~/.mux/skills/"],
    ["kode", "Kode", ".kode/skills/", "~/.kode/skills/"],
    ["command-code", "Command Code", ".commandcode/skills/", "~/.commandcode/skills/"],
    ["cortex", "Cortex Code", ".cortex/skills/", "~/.snowflake/cortex/skills/"],
    ["neovate", "Neovate", ".neovate/skills/", "~/.neovate/skills/"],
  ] as const).map(([id, name, projSkills, globalSkills]) =>
    def(id, name, ["instructions", "skills"], {
      instructions: "AGENTS.md",
      skills: projSkills,
    }, {
      skills: globalSkills,
    }),
  ),
];

// ── Registry API ────────────────────────────────────────────────────────

const platformMap = new Map<string, PlatformDefinition>(
  PLATFORMS.map((p) => [p.id, p]),
);

export function getPlatform(id: string): PlatformDefinition | undefined {
  return platformMap.get(id);
}

export function getAllPlatforms(): PlatformDefinition[] {
  return [...PLATFORMS];
}

export function getPlatformIds(): string[] {
  return PLATFORMS.map((p) => p.id);
}

/**
 * Detect which platforms have configuration files in a project directory.
 * Returns platform IDs that have at least one recognizable file present.
 */
export function detectPlatforms(projectRoot: string): string[] {
  // This is a stub — actual detection reads the filesystem.
  // Implemented in the scanner service.
  void projectRoot;
  return [];
}
