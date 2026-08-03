import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.js";
import { createResource, listResources } from "../../src/models/resource.js";
import {
  addResourceTrackedDirectory,
  listResourceTrackedDirectories,
  removeResourceTrackedDirectory,
  rescanResourceTrackedDirectories,
} from "../../src/services/resource-tracked-directories.ts";

describe("resource-tracked-directories service", () => {
  afterEach(() => {
    delete process.env.HARNESSTAP_HOME;
  });

  it("lists home defaults and custom tracked directories", async () => {
    const context = await createInitializedTestContext("resource-tracked-list");
    try {
      const customDir = join(context.homeDir, "custom-scan-root");
      mkdirSync(customDir, { recursive: true });
      writeFileSync(
        join(context.connection.getHarnesstapDir(), "resource-tracked-directories.json"),
        `${JSON.stringify({ directories: [customDir] }, null, 2)}\n`,
      );
      createResource({
        type: "instruction",
        name: "custom-agents",
        description: "",
        content: "# Agents",
        metadata: {},
        source: "AGENTS.md",
        origin_kind: "local_snapshot",
        origin_ref: customDir,
      });

      const entries = listResourceTrackedDirectories();
      expect(entries.some((entry) => entry.kind === "home_default")).toBe(true);
      const custom = entries.find((entry) => entry.path === customDir);
      expect(custom?.kind).toBe("custom");
      expect(custom?.removable).toBe(true);
      expect(custom?.resource_count).toBe(1);
      expect(Array.isArray(custom?.folders)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("lists discovered resource folders under tracked directories", async () => {
    const context = await createInitializedTestContext("resource-tracked-folders");
    try {
      mkdirSync(join(context.homeDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".cursor", "rules", "home-style.mdc"),
        "---\ndescription: Home style\nalwaysApply: true\n---\n# Home style",
      );

      const projectDir = join(context.homeDir, "folder-scan");
      mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(projectDir, ".cursor", "rules", "project-style.mdc"),
        "---\ndescription: Project style\n---\n# Project style",
      );
      writeFileSync(
        join(context.connection.getHarnesstapDir(), "resource-tracked-directories.json"),
        `${JSON.stringify({ directories: [projectDir] }, null, 2)}\n`,
      );

      const entries = listResourceTrackedDirectories();
      const homeDefault = entries.find((entry) => entry.kind === "home_default");
      expect(homeDefault).toBeTruthy();
      expect(homeDefault?.folders.some((folder) => folder.label === ".cursor")).toBe(
        true,
      );

      const custom = entries.find((entry) => entry.path === projectDir);
      expect(custom?.folders.some((folder) => folder.label === ".cursor")).toBe(
        true,
      );
      expect(
        custom?.folders.find((folder) => folder.label === ".cursor")?.path,
      ).toBe(join(projectDir, ".cursor"));
    } finally {
      await context.cleanup();
    }
  });

  it("adds a custom directory, scans it, and removes tracking later", async () => {
    const context = await createInitializedTestContext("resource-tracked-add");
    try {
      const projectDir = join(context.homeDir, "scan-me");
      mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(projectDir, ".cursor", "rules", "style.mdc"),
        "---\ndescription: Style\n---\n# Style",
      );

      const added = await addResourceTrackedDirectory(projectDir);
      expect(added.imported_count).toBeGreaterThan(0);
      expect(
        listResourceTrackedDirectories().some((entry) => entry.path === projectDir),
      ).toBe(true);

      removeResourceTrackedDirectory(projectDir);
      expect(
        listResourceTrackedDirectories().some((entry) => entry.path === projectDir),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects duplicate custom directories", async () => {
    const context = await createInitializedTestContext("resource-tracked-dup");
    try {
      const projectDir = join(context.homeDir, "dup-scan");
      mkdirSync(projectDir, { recursive: true });

      await addResourceTrackedDirectory(projectDir);
      await expect(addResourceTrackedDirectory(projectDir)).rejects.toThrow(
        "already tracked",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects removing home defaults", async () => {
    const context = await createInitializedTestContext("resource-tracked-home");
    try {
      const homeDefault = listResourceTrackedDirectories().find(
        (entry) => entry.kind === "home_default",
      );
      expect(homeDefault).toBeTruthy();
      if (!homeDefault) {
        return;
      }
      expect(() => removeResourceTrackedDirectory(homeDefault.path)).toThrow(
        "Cannot remove home harness defaults",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rescans home defaults and custom tracked directories", async () => {
    const context = await createInitializedTestContext("resource-tracked-rescan");
    try {
      mkdirSync(join(context.homeDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".cursor", "rules", "home-style.mdc"),
        "---\ndescription: Home style\nalwaysApply: true\n---\n# Home style",
      );

      const customDir = join(context.homeDir, "rescan-me");
      mkdirSync(join(customDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(customDir, ".cursor", "rules", "custom-style.mdc"),
        "---\ndescription: Custom style\n---\n# Custom style",
      );
      writeFileSync(
        join(context.connection.getHarnesstapDir(), "resource-tracked-directories.json"),
        `${JSON.stringify({ directories: [customDir] }, null, 2)}\n`,
      );

      const first = await rescanResourceTrackedDirectories();
      expect(first.imported_count).toBeGreaterThan(0);
      expect(first.rescanned.some((entry) => entry.kind === "home_default")).toBe(
        true,
      );
      expect(
        first.rescanned.some(
          (entry) => entry.kind === "custom" && entry.path === customDir,
        ),
      ).toBe(true);

      const afterFirst = listResources().length;
      expect(afterFirst).toBeGreaterThan(0);

      const second = await rescanResourceTrackedDirectories();
      expect(second.imported_count).toBe(0);
      expect(listResources().length).toBe(afterFirst);
    } finally {
      await context.cleanup();
    }
  });
});
