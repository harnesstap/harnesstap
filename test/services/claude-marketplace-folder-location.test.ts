import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reconcileMarketplacePluginTrees } from "../../src/services/claude-marketplace-plugin-trees.ts";
import {
  claudeMarketplaceEntryOwner,
  emitClaudeMarketplaceRegistrations,
  marketplacePluginSource,
} from "../../src/services/claude-marketplace-registration.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import type { SerializedFile } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("claude-mkt-location-");
  addMarketplace(getHarnesstapDir(), { url: "https://github.com/org/acme.git", name: "acme", platforms: ["claude-code"] });
});
afterEach(async () => {
  await ctx.cleanup();
});

const MP = "acme";
const mpDir = () => join(ctx.homeDir, ".claude/plugins/marketplaces", MP);
const view = (name: string) => join(ctx.homeDir, ".claude/plugins/cache", MP, name, "1.0.0");

function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function emit(): SerializedFile[] {
  const files: SerializedFile[] = [];
  emitClaudeMarketplaceRegistrations(files, ctx.homeDir, new Map([
    [MP, [{ name: "tool", version: "1.0.0", relativeRoot: `.claude/plugins/cache/${MP}/tool/1.0.0` }]],
  ]));
  return files;
}

function knownEntry(files: SerializedFile[]): Record<string, unknown> {
  const known = files.find((file) => file.path === ".claude/plugins/known_marketplaces.json");
  return (JSON.parse(known?.content ?? "{}") as Record<string, Record<string, unknown>>)[MP] ?? {};
}

/** What `claude plugin marketplace update` leaves: a clone of the marketplace repo. */
function cloneMarketplace(): void {
  put(join(mpDir(), ".claude-plugin/marketplace.json"), JSON.stringify({ name: MP, owner: { name: "Acme" }, plugins: [] }));
  put(join(mpDir(), "plugins/tool/a.md"), "one");
}

describe("the folder HarnessTap registers for a marketplace", () => {
  it("is inside Claude Code's marketplaces folder, the only place `marketplace update` accepts", () => {
    const files = emit();
    expect(knownEntry(files).installLocation).toBe(mpDir());
    expect(files.some((file) => file.path === `.claude/plugins/marketplaces/${MP}/.claude-plugin/marketplace.json`)).toBe(true);
  });

  it("is the user's once `marketplace update` replaced it with a clone", () => {
    const files = emit();
    const entry = knownEntry(files);
    put(view("tool") + "/a.md", "one");
    for (const file of files) put(join(ctx.homeDir, file.path), file.content);
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(claudeMarketplaceEntryOwner(ctx.homeDir, MP, entry)).toBe("harnesstap");

    cloneMarketplace();
    expect(claudeMarketplaceEntryOwner(ctx.homeDir, MP, entry)).toBe("claude-changed");
  });

  it("is not HarnessTap's when Claude Code cloned the marketplace there itself", () => {
    const entry = knownEntry(emit());
    cloneMarketplace();
    expect(claudeMarketplaceEntryOwner(ctx.homeDir, MP, entry)).toBe("foreign");
  });

  it("leaves the files of a clone alone, even ones that match what HarnessTap once linked there", () => {
    put(join(view("tool"), "a.md"), "one");
    for (const file of emit()) put(join(ctx.homeDir, file.path), file.content);
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(readFileSync(join(mpDir(), "plugins/tool/a.md"), "utf8")).toBe("one");

    // The clone has the same file, with the same bytes.
    cloneMarketplace();
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(readFileSync(join(mpDir(), "plugins/tool/a.md"), "utf8")).toBe("one");
    expect(existsSync(join(mpDir(), ".claude-plugin/marketplace.json"))).toBe(true);
  });

  it("is not filled with trees for a manifest that is not HarnessTap's", () => {
    put(join(view("tool"), "a.md"), "one");
    put(
      join(mpDir(), ".claude-plugin/marketplace.json"),
      JSON.stringify({ name: MP, plugins: [{ name: "tool", version: "1.0.0", source: marketplacePluginSource("tool") }] }),
    );
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(existsSync(join(mpDir(), "plugins/tool"))).toBe(false);
  });
});
