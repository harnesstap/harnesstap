import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  CLAUDE_SETTINGS_PATH,
  declaredClaudeMarketplaces,
  pruneLeavingClaudeRegistrations,
} from "../../src/services/claude-plugin-registration-prune.ts";
import { recordAddedSettingsMarketplaces } from "../../src/services/claude-settings-marketplaces.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

type Settings = { hooks?: unknown; env?: unknown; theme?: string; extraKnownMarketplaces?: Record<string, unknown> };

const entry = (repo: string) => ({ source: { source: "github", repo } });
const hooks = { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] };

function readSettings(home: string): Settings {
  return JSON.parse(readFileSync(join(home, CLAUDE_SETTINGS_PATH), "utf-8")) as Settings;
}

function writeSettings(home: string, value: unknown): void {
  const path = join(home, CLAUDE_SETTINGS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("a switch that rewrites settings.json", () => {
  it("takes out the extraKnownMarketplaces entries HarnessTap added, when the profile also manages hooks", async () => {
    const context = await createInitializedTestContext("claude-leaving-ekm");
    try {
      const home = context.homeDir;
      writeSettings(home, { theme: "dark", env: { FOO: "bar" } });
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      const declared = createPlugin({
        name: "declared",
        claude: { marketplaces: { mkta: entry("org/mkta"), mktb: entry("org/mktb") } },
      });
      const plain = createPlugin({ name: "plain" });
      // Both profiles manage a hook, so each apply writes settings.json itself.
      for (const profile of [declared, plain]) {
        setPluginTags(profile.id, ["profile"]);
        addResourceToPlugin(
          profile.id,
          createResource({
            type: "hook",
            name: "session-start",
            description: "",
            content: "",
            metadata: { event: "SessionStart", script: "echo ok" },
            source: "manual",
          }).id,
        );
      }

      await applyProfilePlugin("declared", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(Object.keys(readSettings(home).extraKnownMarketplaces ?? {}).sort()).toEqual(["mkta", "mktb"]);

      await applyProfilePlugin("plain", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      const after = readSettings(home);
      expect(after.extraKnownMarketplaces).toBeUndefined();
      expect(after.theme).toBe("dark");
      expect(after.env).toEqual({ FOO: "bar" });
    } finally {
      await context.cleanup();
    }
  });
});

describe("pruneLeavingClaudeRegistrations", () => {
  async function pending(): Promise<{ home: string; file: { path: string; content: string }; cleanup: () => Promise<void> }> {
    const context = await createInitializedTestContext("claude-leaving-ekm-unit");
    const home = context.homeDir;
    const content = `${JSON.stringify({ theme: "dark", hooks, extraKnownMarketplaces: { mkta: entry("org/mkta"), mine: entry("me/mine") } }, null, 2)}\n`;
    recordAddedSettingsMarketplaces(join(home, CLAUDE_SETTINGS_PATH), "{}", JSON.stringify({ extraKnownMarketplaces: { mkta: entry("org/mkta") } }));
    return { home, file: { path: CLAUDE_SETTINGS_PATH, content }, cleanup: context.cleanup };
  }

  it("drops the entry HarnessTap added, keeps the user's", async () => {
    const { home, file, cleanup } = await pending();
    try {
      const [out] = pruneLeavingClaudeRegistrations([file], home);
      expect(Object.keys((JSON.parse(out?.content ?? "{}") as Settings).extraKnownMarketplaces ?? {})).toEqual(["mine"]);
    } finally {
      await cleanup();
    }
  });

  it("keeps the entry of a marketplace the applied profile declares", async () => {
    const { home, file, cleanup } = await pending();
    try {
      const [out] = pruneLeavingClaudeRegistrations([file], home, declaredClaudeMarketplaces({ marketplaces: { mkta: entry("org/mkta") } }));
      expect(out?.content).toBe(file.content);
    } finally {
      await cleanup();
    }
  });

  it("keeps the entry of the marketplace of a plugin the profile enables", async () => {
    const { home, file, cleanup } = await pending();
    try {
      const keep = declaredClaudeMarketplaces({ plugins: [{ id: "tool@mkta", enabled: true }] });
      expect([...keep]).toEqual(["mkta"]);
      const [out] = pruneLeavingClaudeRegistrations([file], home, keep);
      expect(out?.content).toBe(file.content);
    } finally {
      await cleanup();
    }
  });
});
