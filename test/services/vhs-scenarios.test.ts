import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "bun:test";

interface VhsScenarioDefinition {
  id: number;
  slug: string;
  title: string;
  docPath: string;
  tapePath: string;
  outputPath: string;
  fixturePath?: string;
}

const repoRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(repoRoot, "docs/scenarios/vhs/scenarios.json");
const expectedIds = Array.from({ length: 28 }, (_, index) => index + 1);
const fixtureRequiredIds = new Set([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 21, 22, 23, 24, 25, 26, 27,
]);

function loadDefinitions(): VhsScenarioDefinition[] {
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as VhsScenarioDefinition[];
}

describe("VHS scenario manifest", () => {
  it("declares all documented scenarios with repo-relative paths", () => {
    expect(existsSync(manifestPath)).toBe(true);

    const definitions = loadDefinitions();
    expect(definitions.map((definition) => definition.id)).toEqual(expectedIds);

    for (const definition of definitions) {
      expect(definition.docPath.startsWith("docs/scenarios/")).toBe(true);
      expect(definition.tapePath.startsWith("docs/scenarios/vhs/tapes/")).toBe(
        true,
      );
      expect(definition.outputPath.startsWith("docs/scenarios/vhs/output/")).toBe(
        true,
      );

      expect(definition.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

      const paddedId = String(definition.id).padStart(2, "0");
      const expectedTapePrefix = `${paddedId}-${definition.slug}.tape`;
      const expectedOutputPrefix = `${paddedId}-${definition.slug}.gif`;
      expect(definition.tapePath).toContain(expectedTapePrefix);
      expect(definition.outputPath).toContain(expectedOutputPrefix);

      if (fixtureRequiredIds.has(definition.id)) {
        expect(definition.fixturePath).toBeDefined();
        expect(definition.fixturePath).toMatch(/^docs\/scenarios\/vhs\/fixtures\//);
      } else {
        expect(definition.fixturePath).toBeUndefined();
      }
    }
  });

  it("lists every scenario from the manifest", () => {
    const result = spawnSync("bash", ["scripts/generate-vhs-scenarios.sh", "--list"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("01-bootstrap-machine");
    expect(result.stdout).toContain("27-project-sync");
    expect(result.stdout).toContain("28-machine-migration");
  });

  it("has checked-in tapes and fixture roots for project scenarios", () => {
    const definitions = loadDefinitions();

    for (const definition of definitions) {
      expect(existsSync(resolve(repoRoot, definition.tapePath))).toBe(true);

      if (definition.fixturePath) {
        expect(existsSync(resolve(repoRoot, definition.fixturePath))).toBe(true);
      }
    }
  });

  it("links the demo GIF and tape from each covered scenario doc", () => {
    const definitions = loadDefinitions();

    for (const definition of definitions) {
      const doc = readFileSync(resolve(repoRoot, definition.docPath), "utf-8");
      const detailDir = dirname(resolve(repoRoot, definition.docPath));
      const relOutput = relative(detailDir, resolve(repoRoot, definition.outputPath));
      const relTape = relative(detailDir, resolve(repoRoot, definition.tapePath));
      expect(doc).toContain(relOutput);
      expect(doc).toContain(relTape);
    }
  });

  it("uses visible harnessdeck commands and starts tapes at the first visible command", () => {
    const definitions = loadDefinitions();
    const sharedTapePath = resolve(repoRoot, "docs/scenarios/vhs/tapes/_shared.tape");
    const sharedTape = readFileSync(sharedTapePath, "utf-8");

    expect(sharedTape).toContain('Set Shell "bash"');

    for (const definition of definitions) {
      const tape = readFileSync(resolve(repoRoot, definition.tapePath), "utf-8");
      const firstTypedCommand = tape
        .split("\n")
        .find((line) => line.startsWith('Type "'));

      expect(tape).toContain("Require harnessdeck");
      expect(tape).not.toContain("Require node");
      expect(tape).toContain('Type "harnessdeck ');
      expect(tape).not.toContain("node $HD_REPO_ROOT/dist/index.js");
      expect(tape).not.toContain('Type "export HOME=$HOME HARNESSDECK_HOME=$HARNESSDECK_HOME"');
      expect(tape).not.toContain('Type "cd $HD_PROJECT_ROOT"');
      expect(firstTypedCommand).toMatch(/^Type "harnessdeck /);
    }
  });

  it("has the approved story for scan-import-repo", () => {
    const definitions = loadDefinitions();
    const demo = definitions.find((definition) => definition.slug === "scan-import-repo");
    expect(demo).toBeDefined();

    const tape = readFileSync(resolve(repoRoot, demo?.tapePath ?? ""), "utf-8");
    const firstTypedCommand = tape
      .split("\n")
      .find((line) => line.startsWith('Type "'));

    expect(firstTypedCommand).toMatch(/^Type "harnessdeck init"/);
    expect(tape).toContain('Type "harnessdeck project scan ."');
    expect(tape).toContain('Type "harnessdeck resource list"');
    expect(tape).not.toContain("--format json");
  });

  it("embeds a demo GIF in the root README and links to the VHS index", () => {
    const readmePath = resolve(repoRoot, "README.md");
    const readme = readFileSync(readmePath, "utf-8");
    expect(readme).toContain("docs/scenarios/vhs/output/07-preview-apply-layer.gif");
    expect(readme).toContain("docs/scenarios/vhs/README.md");
  });

  it("scenario detail pages do not link to deleted per-scenario VHS output or tapes", () => {
    const staleDetailPaths = [
      "docs/scenarios/details/01-bootstrap-machine.md",
      "docs/scenarios/details/04-scan-import-repo.md",
      "docs/scenarios/details/07-preview-apply-layer.md",
      "docs/scenarios/details/11-builtin-layer.md",
      "docs/scenarios/details/21-detect-drift.md",
      "docs/scenarios/details/27-project-sync.md",
    ];

    for (const detailPath of staleDetailPaths) {
      const doc = readFileSync(resolve(repoRoot, detailPath), "utf-8");
      expect(doc, `${detailPath} should not link to per-scenario VHS output`).not.toMatch(/\.\.\/vhs\/output\/\d{2}-/);
      expect(doc, `${detailPath} should not link to per-scenario VHS tapes`).not.toMatch(/\.\.\/vhs\/tapes\/\d{2}-/);
    }
  });

  it("generate script bakes isolated HOME and HARNESSDECK_HOME into the harnessdeck wrapper", () => {
    const script = readFileSync(
      resolve(repoRoot, "scripts/generate-vhs-scenarios.sh"),
      "utf-8",
    );

    expect(script).toContain('export HOME="$home_dir"');
    expect(script).toContain('export HARNESSDECK_HOME="$hd_dir"');
    expect(script).toContain('export HARNESSDECK_NO_INTERACTIVE=1');
  });

  it("curated GIF artifacts exist on disk", () => {
    const definitions = loadDefinitions();

    for (const definition of definitions) {
      const gifPath = resolve(repoRoot, definition.outputPath);
      expect(existsSync(gifPath), `${definition.outputPath} must be generated`).toBe(
        true,
      );
    }
  });

  it("obsolete per-scenario GIFs are removed from disk", () => {
    const definitions = loadDefinitions();
    const curatedOutputs = new Set(definitions.map((definition) => definition.outputPath));

    const obsoleteGifs = [
      "docs/scenarios/vhs/output/01-existing-repo-adoption.gif",
      "docs/scenarios/vhs/output/11-builtin-layer.gif",
    ].filter((gifPath) => !curatedOutputs.has(gifPath));

    for (const gifPath of obsoleteGifs) {
      expect(existsSync(resolve(repoRoot, gifPath)), `${gifPath} should have been deleted`).toBe(false);
    }
  });

  it("keeps demo output on screen long enough to read", () => {
    const definitions = loadDefinitions();

    for (const definition of definitions) {
      const tape = readFileSync(resolve(repoRoot, definition.tapePath), "utf-8");
      const sleepDurations = tape
        .split("\n")
        .filter((line) => line.startsWith("Sleep "))
        .map((line) => line.slice("Sleep ".length))
        .map((duration) => {
          if (duration.endsWith("ms")) {
            return Number.parseInt(duration.slice(0, -2), 10);
          }

          if (duration.endsWith("s")) {
            return Number.parseFloat(duration.slice(0, -1)) * 1000;
          }

          throw new Error(`Unsupported sleep duration: ${duration}`);
        });

      expect(sleepDurations.length).toBeGreaterThan(0);

      for (const duration of sleepDurations.slice(0, -1)) {
        expect(duration).toBeGreaterThanOrEqual(800);
      }

      expect(sleepDurations.at(-1)).toBeGreaterThanOrEqual(2500);
    }
  });
});
