import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { generateFiles } from "../../src/services/applier.ts";
import { scanProjectWithPluginSource } from "../../src/services/scanner.ts";
import { syncProject } from "../../src/services/project-sync.ts";
import type { Resource, ResourceCreateInput } from "../../src/types.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

const minimalFixture = fileURLToPath(
  new URL("../fixtures/ponytail/minimal", import.meta.url),
);
const fullFixture = fileURLToPath(
  new URL("../fixtures/ponytail/full", import.meta.url),
);

const EXPECTED_PONYTAIL_SKILLS = [
  "ponytail",
  "ponytail-audit",
  "ponytail-debt",
  "ponytail-help",
  "ponytail-review",
] as const;

function toResources(inputs: ResourceCreateInput[]): Resource[] {
  return inputs.map((input, index) =>
    makeResource({
      ...input,
      id: `ponytail-resource-${index}`,
    }),
  );
}

async function loadPonytailApplyResources(fixture: string): Promise<Resource[]> {
  const scan = await scanProjectWithPluginSource(fixture);
  const instructions = scan.harness
    .flatMap((entry) => entry.resources)
    .filter((resource) => resource.type === "instruction");
  const skills = scan.plugin
    .flatMap((entry) => entry.resources)
    .filter((resource) => resource.type === "skill");

  return toResources([...instructions, ...skills]);
}

describe("ponytail portability", () => {
  it("scanProjectWithPluginSource on ponytail/minimal imports 5 skills + instructions", async () => {
    const scan = await scanProjectWithPluginSource(minimalFixture);
    const instructions = scan.harness
      .flatMap((entry) => entry.resources)
      .filter((resource) => resource.type === "instruction");
    const skills = scan.plugin
      .flatMap((entry) => entry.resources)
      .filter((resource) => resource.type === "skill");

    expect(instructions.length).toBeGreaterThanOrEqual(1);
    expect(skills).toHaveLength(5);
    expect(skills.map((skill) => skill.name).sort()).toEqual(
      [...EXPECTED_PONYTAIL_SKILLS].sort(),
    );
  });

  it("layer apply dry-run to claude-code + codex emits native skill paths", async () => {
    const context = await createInitializedTestContext("ponytail-apply-native");

    try {
      const resources = await loadPonytailApplyResources(minimalFixture);
      const results = await generateFiles(
        resources,
        ["claude-code", "codex"],
        context.projectDir,
      );

      const claude = results.find((result) => result.platformId === "claude-code");
      const codex = results.find((result) => result.platformId === "codex");
      const claudePaths = claude?.files.map((file) => file.path) ?? [];
      const codexPaths = codex?.files.map((file) => file.path) ?? [];

      expect(claudePaths.some((path) => path.startsWith(".claude/skills/"))).toBe(
        true,
      );
      expect(codexPaths.some((path) => path.startsWith(".agents/skills/"))).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("layer apply dry-run to windsurf emits .windsurf/rules/ not .agents/skills/", async () => {
    const context = await createInitializedTestContext("ponytail-apply-windsurf");

    try {
      const resources = await loadPonytailApplyResources(minimalFixture);
      const results = await generateFiles(resources, ["windsurf"], context.projectDir);
      const windsurf = results.find((result) => result.platformId === "windsurf");
      const paths = windsurf?.files.map((file) => file.path) ?? [];

      expect(paths.some((path) => path.startsWith(".windsurf/rules/"))).toBe(true);
      expect(paths.some((path) => path.includes(".agents/skills"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("generateFiles for opencode does not emit .mjs plugin files", async () => {
    const context = await createInitializedTestContext("ponytail-opencode-limit");

    try {
      const resources = await loadPonytailApplyResources(minimalFixture);
      const results = await generateFiles(resources, ["opencode"], context.projectDir);
      const paths = results.flatMap((result) => result.files.map((file) => file.path));

      expect(paths.some((path) => path.endsWith(".mjs"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("syncProject with reference auto dry-run succeeds on ponytail/full fixture", async () => {
    const context = await createInitializedTestContext("ponytail-sync-auto");

    try {
      const result = await syncProject({
        projectRoot: fullFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "auto",
      });

      expect(result.files_written).toBeGreaterThan(0);
      expect(result.main_harness).toBe("claude-code");
    } finally {
      await context.cleanup();
    }
  });
});
