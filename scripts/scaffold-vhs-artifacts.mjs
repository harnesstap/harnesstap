#!/usr/bin/env node
/**
 * Regenerates docs/scenarios/vhs/scenarios.json, tapes/, and walkthroughs/
 * from the canonical scenario command sequences below.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const VHS = join(ROOT, "docs/scenarios/vhs");

/** @type {Array<{ id: number; slug: string; title: string; fixturePath?: string; commands: string[]; finalSleepMs?: number }>} */
const SCENARIOS = [
  {
    id: 1,
    slug: "bootstrap-machine",
    title: "Bootstrap HarnessDeck on a machine",
    commands: [
      "harnessdeck init",
      "harnessdeck harness list",
      "harnessdeck layer search foundation",
    ],
  },
  {
    id: 2,
    slug: "default-harness-aliases",
    title: "Choose a default main harness and aliases",
    commands: [
      "harnessdeck init",
      "harnessdeck harness set --main claude-code --aliases cursor,codex",
      "harnessdeck harness status",
    ],
  },
  {
    id: 3,
    slug: "project-harness-preferences",
    title: "Override harness preferences for one repository",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck harness project set --project . --main codex --aliases claude-code,cursor",
      "harnessdeck harness project status --project .",
    ],
  },
  {
    id: 4,
    slug: "scan-import-repo",
    title: "Scan and import an existing repository",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck resource list",
    ],
  },
  {
    id: 5,
    slug: "build-layer-from-resources",
    title: "Build a reusable layer from imported resources",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      'harnessdeck layer create my-setup --description \'Shared project assistant setup\'',
      "harnessdeck resource list",
      "harnessdeck layer show my-setup",
    ],
  },
  {
    id: 6,
    slug: "plugin-constraints",
    title: "Add plugin constraints to a layer",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck layer create my-setup",
      "harnessdeck layer show my-setup",
    ],
  },
  {
    id: 7,
    slug: "preview-apply-layer",
    title: "Preview and apply a layer",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation --dry-run",
      "harnessdeck project apply engineering-foundation",
      "harnessdeck project status .",
    ],
    finalSleepMs: 12000,
  },
  {
    id: 8,
    slug: "audit-plugins",
    title: "Audit plugin resources and layer pins",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck resource list --type plugin",
      "harnessdeck layer create my-setup",
      "harnessdeck layer show my-setup",
    ],
  },
  {
    id: 9,
    slug: "history-revert",
    title: "Review history and recover from a bad apply",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation",
      "harnessdeck project history --project .",
      "harnessdeck project status .",
    ],
    finalSleepMs: 10000,
  },
  {
    id: 10,
    slug: "export-import-layer",
    title: "Export or import a layer bundle",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck layer create my-setup",
      "harnessdeck layer export my-setup --file ./my-setup.harnessdeck.toml",
      "harnessdeck layer import ./my-setup.harnessdeck.toml",
    ],
  },
  {
    id: 11,
    slug: "catalog-baseline",
    title: "Start from a catalog baseline",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation",
      "harnessdeck project status .",
    ],
    finalSleepMs: 12000,
  },
  {
    id: 12,
    slug: "scripts-agents",
    title: "Drive HarnessDeck from scripts or agents",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --format json",
      "harnessdeck harness list --format json",
      "harnessdeck resource list --format json",
    ],
  },
  {
    id: 13,
    slug: "materialization-strategy",
    title: "Choose a materialization strategy",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck harness project set --project . --materialization-strategy symlink-preferred",
      "harnessdeck harness project status --project .",
    ],
  },
  {
    id: 14,
    slug: "curate-resource-db",
    title: "Curate and clean up the local resource DB",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck resource list --type skill",
      "harnessdeck resource list --type instruction",
    ],
  },
  {
    id: 15,
    slug: "subset-platforms",
    title: "Apply to a subset of target platforms",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation --dry-run --harness claude-code,codex",
      "harnessdeck project apply engineering-foundation --harness claude-code,codex",
    ],
    finalSleepMs: 10000,
  },
  {
    id: 16,
    slug: "ci-enforcement",
    title: "Enforce layer and plugin state in CI",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck project apply engineering-foundation",
      "harnessdeck project drift --project .",
    ],
    finalSleepMs: 8000,
  },
  {
    id: 17,
    slug: "migrate-state",
    title: "Migrate HarnessDeck state to a new machine",
    commands: [
      "harnessdeck init",
      "harnessdeck layer search foundation",
      "harnessdeck migrate export ./harnessdeck-state.tar.gz",
    ],
    finalSleepMs: 8000,
  },
  {
    id: 18,
    slug: "plugin-merge-conflict",
    title: "Debug committed vs effective Claude plugin settings",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan . --harness claude-code",
      "harnessdeck resource list --type plugin",
    ],
  },
  {
    id: 19,
    slug: "refresh-plugin-metadata",
    title: "Sync plugin resources from install trees",
    commands: [
      "harnessdeck init",
      "harnessdeck resource sync --dry-run",
    ],
  },
  {
    id: 20,
    slug: "inspect-platforms",
    title: "Inspect supported platforms before targeting",
    commands: [
      "harnessdeck init",
      "harnessdeck harness list",
      "harnessdeck harness list --supported",
    ],
  },
  {
    id: 21,
    slug: "detect-drift",
    title: "Detect drift between project and last applied layer",
    fixturePath: "docs/scenarios/vhs/fixtures/drift-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck project scan .",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation",
      "harnessdeck project drift --project .",
    ],
    finalSleepMs: 10000,
  },
  {
    id: 22,
    slug: "diff-layers",
    title: "Diff two layers",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck layer create team-baseline",
      "harnessdeck layer create my-fork",
      "harnessdeck layer diff team-baseline my-fork",
    ],
  },
  {
    id: 23,
    slug: "validate-layer",
    title: "Doctor-check a layer without writing",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck layer create my-setup",
      "harnessdeck layer doctor my-setup",
      "harnessdeck layer doctor --list-checks",
    ],
  },
  {
    id: 24,
    slug: "apply-from-url",
    title: "Apply a layer directly from a URL",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation --dry-run",
    ],
    finalSleepMs: 8000,
  },
  {
    id: 25,
    slug: "stack-layers",
    title: "Stack multiple layers",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck project scan .",
      "harnessdeck layer create my-overrides",
      "harnessdeck layer search foundation",
      "harnessdeck project apply engineering-foundation my-overrides --dry-run",
    ],
    finalSleepMs: 8000,
  },
  {
    id: 26,
    slug: "layer-from-project",
    title: "Turn a project's current state into a layer",
    fixturePath: "docs/scenarios/vhs/fixtures/scan-project",
    commands: [
      "harnessdeck init",
      "harnessdeck project scan .",
      "harnessdeck layer from-project my-setup --project .",
    ],
    finalSleepMs: 8000,
  },
  {
    id: 27,
    slug: "project-sync",
    title: "True cross-harness project mirror",
    fixturePath: "docs/scenarios/vhs/fixtures/sync-project",
    commands: [
      "harnessdeck init --main codex --aliases claude-code,cursor",
      "harnessdeck project scan .",
      "harnessdeck project mirror . --dry-run",
    ],
    finalSleepMs: 8000,
  },
  {
    id: 28,
    slug: "machine-migration",
    title: "One-command machine migration",
    commands: [
      "harnessdeck init",
      "harnessdeck migrate export ./harnessdeck-state.tar.gz",
      "harnessdeck migrate import ./harnessdeck-state.tar.gz",
    ],
    finalSleepMs: 8000,
  },
];

function paddedId(id) {
  return String(id).padStart(2, "0");
}

function pathsFor(scenario) {
  const prefix = `${paddedId(scenario.id)}-${scenario.slug}`;
  return {
    docPath: `docs/scenarios/vhs/walkthroughs/${prefix}.md`,
    tapePath: `docs/scenarios/vhs/tapes/${prefix}.tape`,
    outputPath: `docs/scenarios/vhs/output/${prefix}.gif`,
  };
}

function sleepFor(index, total, scenario) {
  if (index === total - 1) {
    return scenario.finalSleepMs ?? 3000;
  }
  return index === 0 ? 1500 : 2500;
}

function renderTape(scenario) {
  const { outputPath } = pathsFor(scenario);
  const lines = [
    `Output ${outputPath}`,
    "Source docs/scenarios/vhs/tapes/_shared.tape",
    "Require harnessdeck",
    "",
  ];

  for (const [index, command] of scenario.commands.entries()) {
    const escaped = command.replace(/"/g, '\\"');
    lines.push(`Type "${escaped}"`);
    lines.push("Enter");
    lines.push(`Sleep ${sleepFor(index, scenario.commands.length, scenario)}ms`);
    if (index < scenario.commands.length - 1) {
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderWalkthrough(scenario) {
  const { tapePath, outputPath } = pathsFor(scenario);
  const lines = [
    `# ${scenario.title}`,
    "",
    `[![${scenario.slug} demo](../output/${paddedId(scenario.id)}-${scenario.slug}.gif)](../output/${paddedId(scenario.id)}-${scenario.slug}.gif)`,
    "",
    `Tape: [../tapes/${paddedId(scenario.id)}-${scenario.slug}.tape](../tapes/${paddedId(scenario.id)}-${scenario.slug}.tape)`,
    "",
    "## Commands",
    "",
  ];

  for (const [index, command] of scenario.commands.entries()) {
    lines.push(`${index + 1}. \`${command}\``);
  }

  return `${lines.join("\n")}\n`;
}

function renderManifest() {
  return SCENARIOS.map((scenario) => {
    const paths = pathsFor(scenario);
    const entry = {
      id: scenario.id,
      slug: scenario.slug,
      title: scenario.title,
      ...paths,
    };
    if (scenario.fixturePath) {
      entry.fixturePath = scenario.fixturePath;
    }
    return entry;
  });
}

mkdirSync(join(VHS, "tapes"), { recursive: true });
mkdirSync(join(VHS, "walkthroughs"), { recursive: true });

for (const scenario of SCENARIOS) {
  const paths = pathsFor(scenario);
  writeFileSync(join(ROOT, paths.tapePath), renderTape(scenario));
  writeFileSync(join(ROOT, paths.docPath), renderWalkthrough(scenario));
}

writeFileSync(
  join(VHS, "scenarios.json"),
  `${JSON.stringify(renderManifest(), null, 2)}\n`,
);

console.log(`Wrote ${SCENARIOS.length} VHS scenario artifacts.`);
