import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { createResource } from "../../src/models/resource.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  listResourceContainedFiles,
  packageResourceShowExtras,
  pluginResourceShowExtras,
} from "../../src/services/plugin-resource-show.ts";

const FIXTURE = join(import.meta.dirname, "../fixtures/plugin-import/cursor-team-kit");

describe("pluginResourceShowExtras", () => {
  it("returns undefined for non-plugin resources", async () => {
    const ctx = await createInitializedTestContext("plugin-show-skill");
    try {
      const skill = createResource({
        type: "skill",
        name: "ship",
        description: "Ship",
        content: "# ship",
        metadata: {},
        source: "manual",
      });
      expect(pluginResourceShowExtras(skill)).toBeUndefined();
    } finally {
      await ctx.cleanup();
    }
  });

  it("resolves marketplace URL, install path, and contained files", async () => {
    const ctx = await createInitializedTestContext("plugin-show-mkt");
    try {
      addMarketplace(getHarnesstapDir(), {
        name: "team-mkt",
        url: "https://github.com/acme/team-plugins",
        platforms: ["claude-code"],
      });
      const installRoot = join(
        ctx.homeDir,
        ".claude",
        "plugins",
        "cache",
        "team-mkt",
        "demo",
      );
      mkdirSync(join(installRoot, ".."), { recursive: true });
      cpSync(FIXTURE, installRoot, { recursive: true });
      const skillPath = join(installRoot, "skills", "team", "SKILL.md");
      const pin = createResource({
        type: "plugin",
        name: "demo",
        namespace: "team-mkt",
        description: "Plugin pin: demo@team-mkt",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });
      createResource({
        type: "skill",
        name: "team",
        namespace: "demo",
        description: "Team skill",
        content: "# team",
        metadata: {},
        source: skillPath,
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });
      createResource({
        type: "skill",
        name: "ghost",
        namespace: "demo",
        description: "Missing file",
        content: "# ghost",
        metadata: {},
        source: join(installRoot, "skills", "ghost", "SKILL.md"),
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });

      const extras = pluginResourceShowExtras(pin, { homeRoot: ctx.homeDir });
      expect(extras?.install_path).toBe(installRoot);
      expect(extras?.marketplace_url).toBe("https://github.com/acme/team-plugins");
      expect(extras?.contained_resources.map((row) => row.relative_path)).toEqual([
        ".cursor-plugin/plugin.json",
        "agents/reviewer.md",
        "rules/advisory.mdc",
        "rules/global-review.mdc",
        "rules/review.mdc",
        "skills/team/SKILL.md",
      ]);
      expect(
        extras?.contained_resources.find((row) => row.relative_path === "skills/team/SKILL.md"),
      ).toEqual({
        type: "skill",
        name: "team",
        path: skillPath,
        relative_path: "skills/team/SKILL.md",
      });
      expect(extras?.contained_resources.some((row) => row.name === "ghost")).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it("omits marketplace URL for local plugins and lists files under the install dir", async () => {
    const ctx = await createInitializedTestContext("plugin-show-local");
    try {
      const installRoot = join(ctx.homeDir, ".cursor", "plugins", "design-doc");
      mkdirSync(installRoot, { recursive: true });
      cpSync(FIXTURE, installRoot, { recursive: true });
      const skillPath = join(installRoot, "skills", "team", "SKILL.md");
      const pin = createResource({
        type: "plugin",
        name: "design-doc",
        description: "Dependency: design-doc",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "manual",
        origin_ref: "design-doc",
      });
      createResource({
        type: "skill",
        name: "team",
        namespace: "design-doc",
        description: "Team skill",
        content: "# team",
        metadata: {},
        source: skillPath,
        origin_kind: "manual",
        origin_ref: "design-doc",
      });

      const extras = pluginResourceShowExtras(pin, { homeRoot: ctx.homeDir });
      expect(extras?.marketplace_url).toBeNull();
      expect(extras?.install_path).toBe(installRoot);
      expect(extras?.contained_resources.map((row) => row.relative_path)).toEqual([
        ".cursor-plugin/plugin.json",
        "agents/reviewer.md",
        "rules/advisory.mdc",
        "rules/global-review.mdc",
        "rules/review.mdc",
        "skills/team/SKILL.md",
      ]);
      expect(
        extras?.contained_resources.find((row) => row.relative_path === "skills/team/SKILL.md"),
      ).toEqual({
        type: "skill",
        name: "team",
        path: skillPath,
        relative_path: "skills/team/SKILL.md",
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it("returns null install_path and empty contained_resources when the tree is missing", async () => {
    const ctx = await createInitializedTestContext("plugin-show-missing");
    try {
      const pin = createResource({
        type: "plugin",
        name: "demo",
        namespace: "team-mkt",
        description: "Plugin pin: demo@team-mkt",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });
      const extras = pluginResourceShowExtras(pin, { homeRoot: ctx.homeDir });
      expect(extras).toEqual({
        install_path: null,
        marketplace_url: null,
        contained_resources: [],
        current_version: null,
        advertised_version: null,
        available_versions: [],
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it("resolves contained files from tree-relative child sources", async () => {
    const ctx = await createInitializedTestContext("plugin-show-relative");
    try {
      addMarketplace(getHarnesstapDir(), {
        name: "team-mkt",
        url: "https://github.com/acme/team-plugins",
        platforms: ["claude-code"],
      });
      const installRoot = join(
        ctx.homeDir,
        ".claude",
        "plugins",
        "cache",
        "team-mkt",
        "demo",
      );
      mkdirSync(join(installRoot, ".."), { recursive: true });
      cpSync(FIXTURE, installRoot, { recursive: true });
      const skillPath = join(installRoot, "skills", "team", "SKILL.md");
      const pin = createResource({
        type: "plugin",
        name: "demo",
        namespace: "team-mkt",
        description: "Plugin pin: demo@team-mkt",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });
      createResource({
        type: "skill",
        name: "team",
        namespace: "demo",
        description: "Team skill",
        content: "# team",
        metadata: {},
        source: "skills/team/SKILL.md",
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });

      const extras = pluginResourceShowExtras(pin, { homeRoot: ctx.homeDir });
      expect(extras?.contained_resources.map((row) => row.relative_path)).toContain(
        "skills/team/SKILL.md",
      );
      expect(
        extras?.contained_resources.find((row) => row.relative_path === "skills/team/SKILL.md"),
      ).toEqual({
        type: "skill",
        name: "team",
        path: skillPath,
        relative_path: "skills/team/SKILL.md",
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it("resolves marketplace URL when namespace includes a version constraint", async () => {
    const ctx = await createInitializedTestContext("plugin-show-constraint");
    try {
      addMarketplace(getHarnesstapDir(), {
        name: "team-mkt",
        url: "https://github.com/acme/team-plugins",
        platforms: ["claude-code"],
      });
      const pin = createResource({
        type: "plugin",
        name: "demo",
        namespace: "team-mkt#^1.0.0",
        description: "Plugin pin: demo@team-mkt",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });

      const extras = pluginResourceShowExtras(pin, { homeRoot: ctx.homeDir });
      expect(extras?.marketplace_url).toBe("https://github.com/acme/team-plugins");
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("packageResourceShowExtras", () => {
  it("lists nested files under a skill package directory", async () => {
    const ctx = await createInitializedTestContext("skill-package-show");
    try {
      const skillDir = join(ctx.homeDir, ".claude", "skills", "last30days");
      mkdirSync(join(skillDir, "scripts"), { recursive: true });
      const skillMd = join(skillDir, "SKILL.md");
      writeFileSync(skillMd, "# last30days\n", "utf8");
      writeFileSync(join(skillDir, "scripts", "query.sh"), "#!/bin/sh\n", "utf8");
      const skill = createResource({
        type: "skill",
        name: "last30days",
        description: "Last 30 days",
        content: "",
        metadata: {},
        source: skillMd,
        origin_kind: "local_snapshot",
        origin_ref: skillMd,
      });

      const extras = packageResourceShowExtras(skill);
      expect(extras?.contained_resources.map((row) => row.relative_path)).toEqual(
        ["SKILL.md", "scripts/query.sh"].sort((left, right) => left.localeCompare(right)),
      );
      expect(extras?.contained_resources.find((row) => row.relative_path === "SKILL.md")).toEqual({
        type: "skill",
        name: "SKILL",
        path: skillMd,
        relative_path: "SKILL.md",
      });
      expect(
        extras?.contained_resources.find((row) => row.relative_path === "scripts/query.sh")?.path,
      ).toBe(join(skillDir, "scripts", "query.sh"));
    } finally {
      await ctx.cleanup();
    }
  });

  it("returns undefined for inline skills without a package directory", async () => {
    const ctx = await createInitializedTestContext("skill-inline-show");
    try {
      const skill = createResource({
        type: "skill",
        name: "ship",
        description: "Ship",
        content: "# ship",
        metadata: {},
        source: "manual",
      });
      expect(packageResourceShowExtras(skill)).toBeUndefined();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("listResourceContainedFiles", () => {
  it("skips the tree when includeContained is false and pages large plugin trees", async () => {
    const ctx = await createInitializedTestContext("plugin-show-page");
    try {
      const installRoot = join(ctx.homeDir, ".claude", "plugins", "cache", "team-mkt", "paged");
      mkdirSync(join(installRoot, "skills"), { recursive: true });
      mkdirSync(join(installRoot, "node_modules", "left-pad"), { recursive: true });
      writeFileSync(join(installRoot, "plugin.json"), "{}\n");
      writeFileSync(join(installRoot, "node_modules", "left-pad", "index.js"), "module.exports=1\n");
      for (let index = 0; index < 25; index += 1) {
        const name = `s${String(index).padStart(2, "0")}`;
        mkdirSync(join(installRoot, "skills", name), { recursive: true });
        writeFileSync(join(installRoot, "skills", name, "SKILL.md"), `# ${name}\n`);
      }
      const pin = createResource({
        type: "plugin",
        name: "paged",
        namespace: "team-mkt",
        description: "Plugin pin: paged@team-mkt",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "paged@team-mkt",
      });

      const skipped = pluginResourceShowExtras(pin, {
        homeRoot: ctx.homeDir,
        includeContained: false,
      });
      expect(skipped?.contained_resources).toEqual([]);
      expect(skipped?.install_path).toBe(installRoot);

      const first = listResourceContainedFiles(pin, {
        homeRoot: ctx.homeDir,
        limit: 20,
        offset: 0,
      });
      expect(first.contained_resources).toHaveLength(20);
      expect(first.has_more).toBe(true);
      expect(
        first.contained_resources.some((row) => row.relative_path.includes("node_modules")),
      ).toBe(false);

      const rest = listResourceContainedFiles(pin, {
        homeRoot: ctx.homeDir,
        offset: 20,
      });
      expect(rest.has_more).toBe(false);
      expect(first.contained_resources.length + rest.contained_resources.length).toBe(26);
      expect(
        [...first.contained_resources, ...rest.contained_resources].some((row) =>
          row.relative_path.includes("node_modules"),
        ),
      ).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });
});
