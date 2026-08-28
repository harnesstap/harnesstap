import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  PROJECT_PROFILE_TAG,
  listProfilePlugins,
} from "../../src/constants/profile.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { getPluginResources } from "../../src/models/plugin-model.ts";
import { findProjectConfig } from "../../src/services/project-config.ts";
import { writeStarterProjectConfig } from "../../src/services/project-config-write.ts";
import { bootstrapProjectWorkspace } from "../../src/services/bootstrap-project-workspace.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("bootstrapProjectWorkspace", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withHome() {
    const dir = mkdtempSync(join(tmpdir(), "ht-project-default-home-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    initializeSchema(getDb());
    return dir;
  }

  function withProject(prefix = "ht-project-default-") {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it("creates a project default profile from local project resources", async () => {
    withHome();
    createProfileCommand({ name: "global default" });
    const projectDir = withProject();
    writeTextFile(join(projectDir, "AGENTS.md"), "# Project agents\n");

    const result = await bootstrapProjectWorkspace(projectDir);

    expect(result.default_profile).toBe("project default");
    expect(result.profiles).toEqual(["project default"]);
    const plugin = listProfilePlugins().find((entry) => entry.name === "project default");
    expect(plugin).toBeDefined();
    if (!plugin) {
      throw new Error("expected project default plugin");
    }
    expect(plugin.tags).toContain(PROJECT_PROFILE_TAG);
    const attached = getPluginResources(plugin.id);
    expect(attached.some((resource) => resource.type === "instruction")).toBe(true);
    const config = findProjectConfig(projectDir);
    expect(config?.default_profile).toBe("project default");
    expect(config?.profiles.map((profile) => profile.name)).toEqual([
      "project default",
    ]);
  });

  it("does not replace a custom default_profile when config already exists", async () => {
    withHome();
    createProfileCommand({ name: "work" });
    const projectDir = withProject("ht-project-default-existing-");
    writeStarterProjectConfig({
      projectPath: projectDir,
      defaultProfile: "work",
      profileNames: ["work"],
    });

    const result = await bootstrapProjectWorkspace(projectDir);

    expect(result.already_existed).toBe(true);
    expect(result.default_profile).toBe("work");
    expect(result.profiles).toContain("work");
    expect(result.profiles).toContain("project default");
    const raw = readFileSync(join(projectDir, "apm.yml"), "utf-8");
    expect(raw).toContain("project default");
    expect(raw).toContain("work");
  });

  it("migrates a legacy default project config and makes project default the default", async () => {
    withHome();
    createProfileCommand({ name: "default" });
    const projectDir = withProject("ht-project-default-legacy-");
    writeStarterProjectConfig({
      projectPath: projectDir,
      defaultProfile: "default",
      profileNames: ["default"],
    });

    const result = await bootstrapProjectWorkspace(projectDir);

    expect(result.already_existed).toBe(true);
    expect(result.default_profile).toBe("project default");
    expect(result.profiles).toContain("project default");
    expect(result.profiles).not.toContain("global default");
    expect(result.profiles).not.toContain("default");
  });

  it("uses a unique plugin name when project default already exists", async () => {
    withHome();
    createProfileCommand({
      name: "project default",
    });
    const projectDir = withProject("ht-unique-project-");
    writeTextFile(join(projectDir, "AGENTS.md"), "# Other project\n");

    const result = await bootstrapProjectWorkspace(projectDir);

    expect(result.default_profile).not.toBe("project default");
    expect(result.default_profile.startsWith("project default (")).toBe(true);
    expect(listProfilePlugins().some((plugin) => plugin.name === result.default_profile)).toBe(
      true,
    );
  });
});
