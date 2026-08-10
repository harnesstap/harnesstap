import type {
  MaterialResourceType,
  PlatformDefinition,
  PlatformFeature,
} from "../types.js";

// ── Platform definitions ────────────────────────────────────────────────
// Each platform declares what features it supports and where files live.

type PlatformDefOptions = {
  skillEmission?: PlatformDefinition["skillEmission"];
  hostManagedPaths?: PlatformDefinition["hostManagedPaths"];
};

function def(
  id: string,
  name: string,
  features: PlatformFeature[],
  projectPaths: PlatformDefinition["projectPaths"],
  globalPaths: PlatformDefinition["globalPaths"],
  options?: PlatformDefinition["skillEmission"] | PlatformDefOptions,
): PlatformDefinition {
  const normalized: PlatformDefOptions =
    typeof options === "string" || options === undefined
      ? { skillEmission: options }
      : options;
  return {
    id,
    name,
    supports: new Set(features),
    projectPaths,
    globalPaths,
    ...(normalized.skillEmission ? { skillEmission: normalized.skillEmission } : {}),
    ...(normalized.hostManagedPaths
      ? { hostManagedPaths: normalized.hostManagedPaths }
      : {}),
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
    plugins: "~/.claude/plugins/",
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
    "instructions", "skills", "rules", "mcp", "agents", "hooks"
  ], {
    instructions: "AGENTS.md",
    legacy_instructions: ".cursorrules",
    rules: ".cursor/rules/",
    skills: ".agents/skills/",
    mcp: ".cursor/mcp.json",
    agents: ".cursor/agents/",
    hooks: ".cursor/hooks.json",
  }, {
    rules: "~/.cursor/rules/",
    skills: "~/.cursor/skills/",
    settings: "~/.cursor/mcp.json",
    agents: "~/.cursor/agents/",
    hooks: "~/.cursor/hooks.json",
  }, {
    hostManagedPaths: {
      skills: "~/.cursor/skills-cursor/",
    },
  }),

  // ── Platforms using .agents/ convention ──────────────────────────────
  def("warp", "Warp", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
  }, {
    skills: "~/.agents/skills/",
  }),

  def("opencode", "OpenCode", ["instructions", "skills", "mcp", "agents", "commands"], {
    instructions: "AGENTS.md",
    skills: ".opencode/skills/",
    agents: ".opencode/agents/",
    commands: ".opencode/commands/",
    pathAlternates: {
      commands: [".opencode/command/"],
    },
    mcp: "opencode.json",
  }, {
    skills: "~/.config/opencode/skills/",
    agents: "~/.config/opencode/agents/",
    commands: "~/.config/opencode/commands/",
    settings: "~/.config/opencode/opencode.json",
  }),

  def("github-copilot", "GitHub Copilot", ["instructions", "skills", "mcp", "agents"], {
    instructions: ".github/copilot-instructions.md",
    skills: ".agents/skills/",
    agents: ".github/agents/",
  }, {
    skills: "~/.copilot/skills/",
    settings: "~/.copilot/mcp-config.json",
  }, "instruction-only"),

  def("copilot-cli", "Copilot CLI", ["instructions", "skills", "mcp", "agents"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    mcp: ".copilot/mcp-config.json",
    agents: ".github/agents/",
  }, {
    skills: "~/.copilot/skills/",
    settings: "~/.copilot/mcp-config.json",
  }),

  def("gemini-cli", "Gemini CLI", ["instructions", "skills", "commands"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    commands: "commands/",
    settings: "gemini-extension.json",
  }, {
    skills: "~/.gemini/skills/",
  }, "instruction-only"),

  def("windsurf", "Windsurf", ["instructions", "skills", "rules", "mcp"], {
    instructions: ".windsurfrules",
    rules: ".windsurf/rules/",
    skills: ".agents/skills/",
  }, {
    skills: "~/.codeium/windsurf/skills/",
    settings: "~/.codeium/windsurf/mcp_config.json",
  }, "instruction-only"),

  def("cline", "Cline", ["instructions", "skills", "rules", "mcp"], {
    instructions: "AGENTS.md",
    rules: ".clinerules/",
    legacy_rules: ".clinerules",
    skills: ".agents/skills/",
  }, {
    skills: "~/.agents/skills/",
    settings: "~/.cline/data/settings/cline_mcp_settings.json",
  }, "instruction-only"),

  def("roo", "Roo Code", ["instructions", "skills", "rules", "mcp"], {
    instructions: "AGENTS.md",
    rules: ".roomodes",
    skills: ".roo/skills/",
    mcp: ".roo/mcp.json",
  }, {
    skills: "~/.roo/skills/",
    settings: "~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json",
  }),

  def("continue", "Continue", ["instructions", "skills", "mcp"], {
    instructions: "AGENTS.md",
    skills: ".continue/skills/",
    mcp: ".continue/mcp.json",
  }, {
    skills: "~/.continue/skills/",
  }),

  def("goose", "Goose", ["instructions", "skills", "mcp", "hooks", "commands"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    commands: "recipes/",
    mcp: ".config/goose/config.yaml",
    pathAlternates: {
      instructions: [".goosehints"],
      skills: [".goose/skills/"],
    },
  }, {
    instructions: "~/.config/goose/.goosehints",
    skills: "~/.agents/skills/",
    settings: "~/.config/goose/config.yaml",
  }),

  def("trae", "Trae", ["instructions", "skills", "rules", "mcp"], {
    instructions: "AGENTS.md",
    rules: ".traerules",
    skills: ".trae/skills/",
    mcp: ".trae/mcp.json",
  }, {
    skills: "~/.trae/skills/",
  }),

  def("openhands", "OpenHands", ["instructions", "skills", "mcp"], {
    instructions: "AGENTS.md",
    skills: ".openhands/skills/",
  }, {
    skills: "~/.openhands/skills/",
    settings: "~/.openhands/mcp.json",
  }),

  def("kiro", "Kiro", ["instructions", "skills", "rules"], {
    instructions: "AGENTS.md",
    rules: ".kiro/steering/",
    skills: ".agents/skills/",
  }, {
    skills: "~/.kiro/skills/",
  }, "instruction-only"),

  // Pi extensions install via `pi install git:...`, not layer apply.
  // HarnessTap can scan `.agents/skills/` but cannot materialize pi-extension/index.js.
  def("pi", "Pi", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
  }, {}),

  // Google Antigravity (IDE / CLI / AGY) share the same workspace layout.
  def("antigravity", "Antigravity", [
    "instructions", "skills", "rules", "mcp", "commands",
  ], {
    instructions: "AGENTS.md",
    rules: ".agents/rules/",
    skills: ".agents/skills/",
    commands: ".agents/workflows/",
    mcp: ".agents/mcp_config.json",
    pathAlternates: {
      instructions: ["GEMINI.md"],
    },
  }, {
    instructions: "~/.gemini/GEMINI.md",
    skills: "~/.gemini/skills/",
    commands: "~/.gemini/config/global_workflows/",
    settings: "~/.gemini/config/mcp_config.json",
  }),

  def("amazon-q", "Amazon Q Developer", ["instructions", "rules", "mcp"], {
    instructions: "AmazonQ.md",
    rules: ".amazonq/rules/",
    mcp: ".amazonq/mcp.json",
    pathAlternates: {
      instructions: ["AGENTS.md"],
    },
  }, {
    settings: "~/.aws/amazonq/mcp.json",
  }),

  def("aider", "Aider", ["instructions"], {
    instructions: "CONVENTIONS.md",
    settings: ".aider.conf.yml",
    pathAlternates: {
      instructions: ["AGENTS.md"],
    },
  }, {
    settings: "~/.aider.conf.yml",
  }),

  def("zed", "Zed", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    pathAlternates: {
      instructions: [".rules"],
    },
  }, {
    instructions: "~/.config/zed/AGENTS.md",
    skills: "~/.agents/skills/",
  }),

  def("devin", "Devin", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    settings: ".devin/config.json",
    pathAlternates: {
      instructions: ["AGENTS.local.md", "AGENT.md"],
    },
  }, {
    instructions: "~/.config/devin/AGENTS.md",
    skills: "~/.agents/skills/",
    settings: "~/.config/devin/config.json",
  }),

  def("jules", "Jules", ["instructions", "skills"], {
    instructions: "AGENTS.md",
    skills: ".agents/skills/",
    pathAlternates: {
      instructions: ["JULES.md"],
    },
  }, {
    skills: "~/.agents/skills/",
  }),

  def("cody", "Sourcegraph Cody", ["instructions", "mcp"], {
    instructions: "AGENTS.md",
    settings: "cody.json",
  }, {
    settings: "~/.config/sourcegraph/cody.json",
  }),

  def("grok-build", "Grok Build", [
    "instructions",
    "skills",
    "mcp",
    "permissions",
    "hooks",
    "agents",
    "commands",
    "model_config",
  ], {
    instructions: "AGENTS.md",
    skills: ".grok/skills/",
    agents: ".grok/agents/",
    hooks: ".grok/hooks/",
    commands: ".agents/commands/",
    mcp: ".grok/config.toml",
    permissions: ".grok/config.toml",
    settings: ".grok/config.toml",
    pathAlternates: {
      instructions: ["AGENT.md", "Agents.md"],
      skills: [".agents/skills/"],
    },
  }, {
    skills: "~/.grok/skills/",
    agents: "~/.grok/agents/",
    hooks: "~/.grok/hooks/",
    commands: "~/.agents/commands/",
    settings: "~/.grok/config.toml",
    pathAlternates: {
      skills: ["~/.agents/skills/"],
    },
  }),

  // ── .agents/ convention platforms (skills + instructions) ───────────
  ...([
    ["amp", "Amp", ".agents/skills/", "~/.config/agents/skills/"],
    ["kilo", "Kilo Code", ".kilocode/skills/", "~/.kilocode/skills/"],
    ["augment", "Augment", ".augment/skills/", "~/.augment/skills/"],
    ["firebender", "Firebender", ".agents/skills/", "~/.firebender/skills/"],
    ["junie", "Junie", ".junie/skills/", "~/.junie/skills/"],
    ["zencoder", "Zencoder", ".zencoder/skills/", "~/.zencoder/skills/"],
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

// ── Resource conflict classes ───────────────────────────────────────────
// Set-like types are keyed by distinct names; losing one side of an
// equal-depth collision is recoverable, so it warns. Singleton types change
// behavior or weaken a security posture when silently dropped, so an
// equal-depth collision is an error.

export type ResourceClass = "set" | "singleton";

export const RESOURCE_CLASSES: Record<MaterialResourceType, ResourceClass> = {
  skill: "set",
  rule: "set",
  agent: "set",
  command: "set",
  hook: "set",
  mcp_server: "set",
  instruction: "singleton",
  model_config: "singleton",
  permission: "singleton",
  env_var: "singleton",
};

export function resourceClass(type: MaterialResourceType): ResourceClass {
  return RESOURCE_CLASSES[type];
}
