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
const expectedIds = [1];
const fixtureRequiredIds = new Set([1]);

describe("VHS scenario manifest", () => {
  it("declares the curated scenarios with repo-relative paths", () => {
    expect(existsSync(manifestPath)).toBe(true);

    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];

    expect(definitions.map((definition) => definition.id)).toEqual(expectedIds);

    const demo = definitions[0];
    expect(demo.id).toBe(1);
    expect(demo.slug).toBe("existing-repo-adoption");
    expect(demo.tapePath).toBe("docs/scenarios/vhs/tapes/01-existing-repo-adoption.tape");
    expect(demo.outputPath).toBe("docs/scenarios/vhs/output/01-existing-repo-adoption.gif");
    expect(demo.fixturePath).toBe("docs/scenarios/vhs/fixtures/scan-project");

    for (const definition of definitions) {
      expect(definition.docPath.startsWith("docs/scenarios/")).toBe(true);
      expect(definition.tapePath.startsWith("docs/scenarios/vhs/tapes/")).toBe(
        true,
      );
      expect(definition.outputPath.startsWith("docs/scenarios/vhs/output/")).toBe(
        true,
      );

      // Validate slug is kebab-case
      expect(definition.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

      // Validate tapePath and outputPath contain zero-padded id and slug
      const paddedId = String(definition.id).padStart(2, "0");
      const expectedTapePrefix = `${paddedId}-${definition.slug}.tape`;
      const expectedOutputPrefix = `${paddedId}-${definition.slug}.gif`;
      expect(definition.tapePath).toContain(expectedTapePrefix);
      expect(definition.outputPath).toContain(expectedOutputPrefix);

      // Validate fixture presence and path
      if (fixtureRequiredIds.has(definition.id)) {
        expect(definition.fixturePath).toBeDefined();
        expect(definition.fixturePath).toMatch(/^docs\/scenarios\/vhs\/fixtures\//);
      } else {
        expect(definition.fixturePath).toBeUndefined();
      }
    }
  });

  it("lists the curated scenarios without requiring VHS", () => {
    const result = spawnSync("bash", ["scripts/generate-vhs-scenarios.sh", "--list"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("01-existing-repo-adoption");
    expect(result.stdout).not.toContain("27-project-sync");
  });

  it("has checked-in tapes and fixture roots for the curated scenarios", () => {
    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];

    for (const definition of definitions) {
      expect(existsSync(resolve(repoRoot, definition.tapePath))).toBe(true);

      if (definition.fixturePath) {
        expect(existsSync(resolve(repoRoot, definition.fixturePath))).toBe(true);
      }
    }
  });

  it("links the demo GIF and tape from each covered scenario doc", () => {
    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];

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
    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];
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

  it("has the approved story for existing-repo-adoption", () => {
    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];
    const demo = definitions.find((d) => d.slug === "existing-repo-adoption");
    expect(demo).toBeDefined();

    const tape = readFileSync(resolve(repoRoot, demo?.tapePath ?? ""), "utf-8");
    const firstTypedCommand = tape
      .split("\n")
      .find((line) => line.startsWith('Type "'));

    // First typed command should be harnessdeck init
    expect(firstTypedCommand).toMatch(/^Type "harnessdeck init"/);

    // Tape contains the visible commands from the approved story
    expect(tape).toContain('Type "harnessdeck project scan ."');
    expect(tape).toContain('Type "harnessdeck resource list"');
    expect(tape).toContain('Type "harnessdeck layer search fullstack"');
    expect(tape).toContain('Type "harnessdeck project apply nextjs-fullstack --project . --harness codex"');
    expect(tape).toContain('Type "harnessdeck project status ."');

    // Tape does not use --format json
    expect(tape).not.toContain("--format json");
  });

  it("embeds the single demo GIF in the root README and links to the walkthrough doc", () => {
    const readmePath = resolve(repoRoot, "README.md");
    const readme = readFileSync(readmePath, "utf-8");
    expect(readme).toContain("Existing repo adoption walkthrough");
    expect(readme).toContain("docs/scenarios/vhs/walkthroughs/01-existing-repo-adoption.md");
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

  it("root README links to the canonical walkthrough doc", () => {
    const readmePath = resolve(repoRoot, "README.md");
    const readme = readFileSync(readmePath, "utf-8");
    const walkthroughDoc = "docs/scenarios/vhs/walkthroughs/01-existing-repo-adoption.md";
    expect(readme).toContain(walkthroughDoc);
    expect(existsSync(resolve(repoRoot, walkthroughDoc))).toBe(true);
  });

  it("README reflects the current toolkit framing and command surface", () => {
    const readmePath = resolve(repoRoot, "README.md");
    const readme = readFileSync(readmePath, "utf-8");

    expect(readme).toContain("Agent harness configuration toolkit");
    expect(readme).toContain("hd harness list");
    expect(readme).toContain("hd layer doctor");
    expect(readme).toContain("hd layer combine my-setup research-helper --type skill");
    expect(readme).toContain(
      "hd layer combine my-setup plugin:formatter@my-marketplace --version",
    );
    expect(readme).not.toContain("hd platform list");
    expect(readme).not.toContain("hd layer validate");
    expect(readme).not.toContain("hd layer pull-plugin");
    expect(readme).toContain("```mermaid");
  });

  it("SPEC reflects the current toolkit framing and command surface", () => {
    const specPath = resolve(repoRoot, "SPEC.md");
    const spec = readFileSync(specPath, "utf-8");

    expect(spec).toContain("Agent harness configuration toolkit");
    expect(spec).toContain("harness list");
    expect(spec).toContain("layer doctor");
    expect(spec).toContain("layer combine");
    expect(spec).toContain("layer uncombine");
    expect(spec).toContain("wizard mode");
    expect(spec).toContain("```mermaid");
    expect(spec).not.toContain("harnessdeck platform list");
    expect(spec).not.toContain("harnessdeck layer validate");
  });

  it("new GIF artifact exists on disk", () => {
    const newGif = resolve(repoRoot, "docs/scenarios/vhs/output/01-existing-repo-adoption.gif");
    expect(existsSync(newGif), "01-existing-repo-adoption.gif must be generated").toBe(true);
  });

  it("obsolete per-scenario GIFs are removed from disk", () => {
    const obsoleteGifs = [
      "docs/scenarios/vhs/output/01-bootstrap-machine.gif",
      "docs/scenarios/vhs/output/04-scan-import-repo.gif",
      "docs/scenarios/vhs/output/07-preview-apply-layer.gif",
      "docs/scenarios/vhs/output/11-builtin-layer.gif",
      "docs/scenarios/vhs/output/21-detect-drift.gif",
      "docs/scenarios/vhs/output/27-project-sync.gif",
    ];

    for (const gifPath of obsoleteGifs) {
      expect(existsSync(resolve(repoRoot, gifPath)), `${gifPath} should have been deleted`).toBe(false);
    }
  });

  it("keeps demo output on screen long enough to read", () => {
    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];

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
