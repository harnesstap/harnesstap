import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import {
  addDependencyToPlugin,
  addResourceToPlugin,
  createPlugin,
  getPluginResources,
  listPlugins,
  stampPluginOrigin,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { AP_SCHEMA_URL } from "../../src/services/agent-plugins/validate.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import {
  isAutoInstallable,
  runAutoInstall,
  SKIP_ACTIVE_DRIFT,
  SKIP_LOCAL_EDITS,
  SKIP_MAJOR,
  SKIP_NOT_CATALOG,
  type AutoInstallDeps,
} from "../../src/services/upstream-auto-install.ts";
import { getComposedPluginResources } from "../../src/services/plugin-extends.ts";
import { listNotifications } from "../../src/services/notifications.ts";
import { readUpstreamChecks } from "../../src/services/upstream-check-read.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("auto-install-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function pulled(name: string, version = "1.0.0"): string {
  const plugin = createPlugin({ name, version, origin: "catalog", org_slug: "acme", catalog_slug: "default" });
  setPluginOrigin(plugin.id, "catalog");
  stampPluginOrigin(plugin.id, { locator: `acme/default/${name}`, fingerprint: version, fingerprintKind: "catalog_version" });
  const old = createResource({ type: "skill", name: `${name}-old`, description: "old", content: "old body\n", metadata: {}, source: "test" });
  addResourceToPlugin(plugin.id, old.id);
  return plugin.id;
}

function stored(name: string, local: string, inRange: string, major = "", status = "update"): void {
  getDb()
    .prepare(
      `INSERT INTO upstream_checks (plugin_name, ref, local_version, latest_in_range, latest_major, status, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(name, `acme/default/${name}@^${local}`, local, inRange, major, status, new Date().toISOString());
}

/** The published 1.0.0 matches what pulled() stored; any other version is new. */
function pkg(name: string, version: string) {
  if (version === "1.0.0") {
    return {
      version,
      files: {
        "plugin.json": { encoding: "utf8" as const, content: JSON.stringify({ $schema: AP_SCHEMA_URL, name, version }) },
        [`skills/${name}-old/SKILL.md`]: { encoding: "utf8" as const, content: `---\nname: ${name}-old\ndescription: old\n---\nold body\n` },
      },
    };
  }
  return {
    version,
    files: {
      "plugin.json": { encoding: "utf8" as const, content: JSON.stringify({ $schema: AP_SCHEMA_URL, name, version }) },
      "skills/fresh/SKILL.md": { encoding: "utf8" as const, content: "---\nname: fresh\ndescription: fresh\n---\n# fresh\n" },
    },
  };
}

function deps(overrides: Partial<AutoInstallDeps> = {}): Partial<AutoInstallDeps> & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    downloadCatalogPackage: async (input) => {
      asked.push(`${input.pluginSlug}@${input.version}`);
      return pkg(input.pluginSlug, input.version ?? "");
    },
    activeProfileName: () => undefined,
    activeProfileDrifted: async () => false,
    applyActiveProfile: async () => "applied",
    ...overrides,
  };
}

function composedBody(pluginId: string, name: string): string {
  return getComposedPluginResources(pluginId).find((r) => r.name === name)?.content ?? "";
}

const versionsOf = (name: string) =>
  listPlugins()
    .filter((plugin) => plugin.name === name)
    .map((plugin) => `${plugin.version}${plugin.frozen_at ? " (frozen)" : ""}`)
    .sort();

describe("the major guard", () => {
  it("accepts only a newer minor or patch inside the caret range", () => {
    expect(isAutoInstallable("1.0.0", "1.2.3", "acme/default/x@^1.0.0")).toBe(true);
    expect(isAutoInstallable("1.0.0", "1.0.1", "acme/default/x@^1.0.0")).toBe(true);
    expect(isAutoInstallable("1.0.0", "2.0.0", "acme/default/x@^1.0.0")).toBe(false);
    expect(isAutoInstallable("1.0.0", "2.0.0", "acme/default/x@*")).toBe(false);
    expect(isAutoInstallable("1.2.0", "1.1.0", "acme/default/x@^1.0.0")).toBe(false);
    expect(isAutoInstallable("1.0.0", "1.3.0-beta.1", "acme/default/x@^1.0.0")).toBe(false);
    expect(isAutoInstallable("0.1.0", "0.2.0", "acme/default/x@^0.1.0")).toBe(false);
    expect(isAutoInstallable("1.0.0", "1.3.0", "acme/default/x@~1.0.0")).toBe(false);
  });
});

describe("runAutoInstall", () => {
  it("installs the in-range version, never the major, and keeps the old version as a frozen cut", async () => {
    pulled("lint");
    stored("lint", "1.0.0", "1.2.0", "2.0.0");
    const d = deps();
    const rows = await runAutoInstall({ deps: d });
    expect(d.asked).toEqual(["lint@1.0.0", "lint@1.2.0"]);
    expect(rows).toEqual([{ plugin_name: "lint", from: "1.0.0", to: "1.2.0", status: "installed" }]);
    expect(versionsOf("lint")).toEqual(["1.0.0 (frozen)", "1.2.0"]);
    const frozen = listPlugins().find((plugin) => plugin.name === "lint" && plugin.frozen_at);
    expect(getPluginResources(frozen!.id).map((r) => r.name)).toContain("lint-old");
    const row = readUpstreamChecks().find((r) => r.plugin_name === "lint");
    expect([row?.local_version, row?.status]).toEqual(["1.2.0", "current"]);
    expect(listNotifications().map((n) => [n.kind, n.plugin_name, n.title, n.payload.version])).toEqual([
      ["auto_installed", "lint", "lint updated to 1.2.0", "1.2.0"],
    ]);
  });

  it("never installs a major, even when it is the only newer version", async () => {
    pulled("fmt");
    stored("fmt", "1.0.0", "1.0.0", "2.0.0", "major");
    const d = deps();
    const rows = await runAutoInstall({ deps: d });
    expect(d.asked).toEqual([]);
    expect(rows).toEqual([{ plugin_name: "fmt", from: "1.0.0", to: "2.0.0", status: "skipped", message: SKIP_MAJOR }]);
    expect(versionsOf("fmt")).toEqual(["1.0.0"]);
    expect(listNotifications()).toEqual([]);
  });

  it("refuses a catalog that sends a different version than asked, and changes nothing", async () => {
    pulled("lint");
    stored("lint", "1.0.0", "1.2.0");
    const rows = await runAutoInstall({
      deps: deps({ downloadCatalogPackage: async (input) => pkg("lint", input.version === "1.0.0" ? "1.0.0" : "2.0.0") }),
    });
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.message).toContain("sent 2.0.0 instead of 1.2.0");
    expect(versionsOf("lint")).toEqual(["1.0.0"]);
  });

  it("installs a fresh pull even though its dirty flag is set", async () => {
    const id = pulled("lint");
    getDb().prepare("UPDATE plugins SET dirty = 1 WHERE id = ?").run(id);
    stored("lint", "1.0.0", "1.2.0");
    const rows = await runAutoInstall({ deps: deps() });
    expect(rows[0]?.status).toBe("installed");
  });

  it("skips a plugin whose content no longer matches its published version", async () => {
    const id = pulled("lint");
    const skill = getPluginResources(id).find((r) => r.name === "lint-old")!;
    getDb().prepare("UPDATE resources SET content = 'my edit' WHERE id = ?").run(skill.id);
    stored("lint", "1.0.0", "1.2.0");
    const d = deps();
    const rows = await runAutoInstall({ deps: d });
    expect(d.asked).toEqual(["lint@1.0.0"]);
    expect(rows[0]).toMatchObject({ status: "skipped", message: SKIP_LOCAL_EDITS });
    expect(versionsOf("lint")).toEqual(["1.0.0"]);
  });

  it("counts an added plugin dependency as a local edit", async () => {
    const id = pulled("lint");
    addDependencyToPlugin(id, "extra-tool", "^1.0.0");
    stored("lint", "1.0.0", "1.2.0");
    const rows = await runAutoInstall({ deps: deps() });
    expect(rows[0]).toMatchObject({ status: "skipped", message: SKIP_LOCAL_EDITS });
    expect(versionsOf("lint")).toEqual(["1.0.0"]);
  });

  it("skips separate copies and authored plugins", async () => {
    createPlugin({ name: "mine", version: "1.0.0" });
    stored("mine", "1.0.0", "1.1.0");
    const rows = await runAutoInstall({ deps: deps() });
    expect(rows[0]).toMatchObject({ status: "skipped", message: SKIP_NOT_CATALOG });
  });

  it("leaves a failed download with the library untouched", async () => {
    pulled("lint");
    stored("lint", "1.0.0", "1.2.0");
    const rows = await runAutoInstall({
      deps: deps({
        downloadCatalogPackage: async (input) => {
          if (input.version === "1.0.0") return pkg("lint", "1.0.0");
          throw new Error("offline");
        },
      }),
    });
    expect(rows[0]).toMatchObject({ status: "failed", message: "offline" });
    expect(versionsOf("lint")).toEqual(["1.0.0"]);
  });

  it("re-applies the active profile only when its harness files are clean", async () => {
    pulled("lint");
    stored("lint", "1.0.0", "1.2.0");
    const applied: string[] = [];
    const clean = await runAutoInstall({
      deps: deps({ activeProfileName: () => "lint", applyActiveProfile: async (name) => { applied.push(name); return "applied"; } }),
    });
    expect(applied).toEqual(["lint"]);
    expect(clean[0]).toMatchObject({ status: "installed", applied: true });

    pulled("fmt");
    stored("fmt", "1.0.0", "1.0.5");
    const drifted = await runAutoInstall({
      deps: deps({
        activeProfileName: () => "fmt",
        activeProfileDrifted: async () => true,
        applyActiveProfile: async (name) => { applied.push(name); return "applied"; },
      }),
    });
    expect(applied).toEqual(["lint"]);
    expect(drifted.find((r) => r.plugin_name === "fmt")).toMatchObject({ status: "installed", applied: false, message: SKIP_ACTIVE_DRIFT });
  });

  it("skips when the new version would rewrite a skill another plugin also uses", async () => {
    const id = pulled("lint");
    const mine = createPlugin({ name: "my-tools", version: "1.0.0" });
    const sharedSkill = getPluginResources(id).find((r) => r.name === "lint-old")!;
    addResourceToPlugin(mine.id, sharedSkill.id);
    stored("lint", "1.0.0", "1.1.0");
    const rows = await runAutoInstall({
      deps: deps({
        downloadCatalogPackage: async (input) => input.version === "1.0.0" ? pkg("lint", "1.0.0") : ({
          version: "1.1.0",
          files: {
            "plugin.json": { encoding: "utf8", content: JSON.stringify({ $schema: AP_SCHEMA_URL, name: "lint", version: "1.1.0" }) },
            "skills/lint-old/SKILL.md": { encoding: "utf8", content: "---\nname: lint-old\ndescription: new\n---\nnew body\n" },
          },
        }),
      }),
    });
    expect(rows[0]).toMatchObject({ status: "skipped", message: "would change skill:lint-old, which my-tools also uses; install skipped" });
    expect(versionsOf("lint")).toEqual(["1.0.0"]);
    expect(composedBody(mine.id, "lint-old")).toBe("old body\n");
  });
});
