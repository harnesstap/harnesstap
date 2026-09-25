/**
 * Desktop-facing harness metadata. Keep in sync with
 * `PANEL_HARNESS_IDS` / platform `supports` in the agent registry.
 */

export const DESKTOP_HARNESS_IDS = ["claude-code", "cursor"] as const;

export type DesktopHarnessId = (typeof DESKTOP_HARNESS_IDS)[number];

/** Shared `~/.agents/` hub. Not a registry platform; used as a section mark. */
export const SHARED_AGENTS_SECTION_ID = "agents";

/** Display names for known harness ids (desktop + common extras). */
const HARNESS_NAMES: Record<string, string> = {
  [SHARED_AGENTS_SECTION_ID]: "Agents",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  opencode: "OpenCode",
  goose: "Goose",
  "gemini-cli": "Gemini CLI",
  "github-copilot": "GitHub Copilot",
  "copilot-cli": "Copilot CLI",
  "grok-build": "Grok Build",
  "muse-code": "Muse Code",
  "minimax-code": "MiniMax Code",
};

/**
 * Which desktop panel harnesses support each resource type.
 * Derived from `src/platforms/registry.ts` feature sets for claude-code + cursor.
 */
const RELATED_BY_TYPE: Record<string, readonly DesktopHarnessId[]> = {
  instruction: ["claude-code", "cursor"],
  skill: ["claude-code", "cursor"],
  rule: ["claude-code", "cursor"],
  mcp_server: ["claude-code", "cursor"],
  permission: ["claude-code"],
  hook: ["claude-code", "cursor"],
  agent: ["claude-code", "cursor"],
  command: ["claude-code"],
  env_var: ["claude-code"],
  model_config: ["claude-code"],
  plugin_pin: ["claude-code", "cursor"],
  plugin: ["claude-code", "cursor"],
  plugin_ref: ["claude-code", "cursor"],
};

export function harnessDisplayName(id: string): string {
  return HARNESS_NAMES[id] ?? id;
}

export function harnessIdFromDisplayName(name: string): string | null {
  for (const [id, display] of Object.entries(HARNESS_NAMES)) {
    if (display === name) return id;
  }
  return null;
}

/** Harnesses shown as “related” for a library/profile resource type. */
export function relatedHarnessesForResourceType(
  type: string,
): readonly DesktopHarnessId[] {
  return RELATED_BY_TYPE[type] ?? DESKTOP_HARNESS_IDS;
}
