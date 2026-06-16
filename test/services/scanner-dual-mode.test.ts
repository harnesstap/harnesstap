import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

const fixture = join(import.meta.dirname, "../fixtures/ponytail/minimal");
const superpowersFixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("scanProjectWithPluginSource", () => {
  it("imports repo-root skills when harness files are also present", async () => {
    const scanner = await import("../../src/services/scanner.ts");
    const result = await scanner.scanProjectWithPluginSource(fixture);
    const harnessResources = result.harness.flatMap((r) => r.resources);
    const pluginResources = result.plugin.flatMap((p) => p.resources);
    expect(harnessResources.some((r) => r.type === "instruction")).toBe(true);
    expect(
      pluginResources.some((r) => r.type === "skill" && r.name === "ponytail"),
    ).toBe(true);
  });

  it("hasPluginSourceLayout detects claude plugin manifest at repo root", async () => {
    const scanner = await import("../../src/services/scanner.ts");
    expect(scanner.hasPluginSourceLayout(fixture)).toBe(true);
  });
});

describe("persistMergedProjectScan deduplication", () => {
  it("does not duplicate skills imported from plugin source and gemini harness scan", async () => {
    const context = await createInitializedTestContext("scanner-sp-dedup");
    try {
      const scanner = await import("../../src/services/scanner.ts");
      const result = await scanner.persistMergedProjectScan(superpowersFixture, undefined, {
        originRef: superpowersFixture,
      });
      const skills = result.resources.filter((r) => r.type === "skill");
      const names = skills.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
      expect(skills.length).toBe(2); // alpha, beta
    } finally {
      await context.cleanup();
    }
  });
});

describe("persistMergedProjectScan", () => {
  it("persists harness instructions and plugin skills with dedup", async () => {
    const context = await createInitializedTestContext("scanner-dual-mode-persist");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const result = await scanner.persistMergedProjectScan(fixture, undefined, {
        originRef: fixture,
      });

      expect(result.resources.some((r) => r.type === "instruction")).toBe(true);
      expect(
        result.resources.some(
          (r) => r.type === "skill" && r.name === "ponytail" && r.namespace === "ponytail",
        ),
      ).toBe(true);

      const persisted = resourceModel.listResources();
      const instructionKeys = persisted
        .filter((r) => r.type === "instruction")
        .map((r) => `${r.type}:${r.name}:${r.namespace ?? ""}`);
      expect(new Set(instructionKeys).size).toBe(instructionKeys.length);
    } finally {
      await context.cleanup();
    }
  });
});
