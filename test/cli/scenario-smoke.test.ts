import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

interface ScenarioSmokeCase {
  id: number;
  argv: string[];
  requiresGitOrigin?: boolean;
  requiresProjectConfig?: boolean;
  expectFailure?: boolean;
}

const repoRoot = join(import.meta.dirname, "../..");
const skillPackageFixture = join(
  repoRoot,
  "test/fixtures/skill-packages/mattpocock-minimal",
);
const smokeCases = JSON.parse(
  readFileSync(join(repoRoot, "docs/scenarios/scenario-smoke.json"), "utf-8"),
) as ScenarioSmokeCase[];

const VALID_PROJECT_CONFIG = `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "dev"

[[profiles]]
name = "dev"
source = "local"
selector = "default"
`;

function writeProjectConfig(projectDir: string) {
  mkdirSync(join(projectDir, ".harnessdeck"), { recursive: true });
  writeTextFile(join(projectDir, ".harnessdeck", "config.toml"), VALID_PROJECT_CONFIG);
}

function resolveSmokeArgv(
  argv: string[],
  context: Awaited<ReturnType<typeof createTestContext>>,
): string[] {
  return argv.map((arg) => {
    if (arg === "__MIGRATE_OUT__") {
      return join(context.rootDir, "migrate-smoke.json");
    }
    if (arg === "__MISSING_ARCHIVE__") {
      return join(context.rootDir, "missing-migrate-archive.tar.gz");
    }
    if (arg === "__SKILL_PACKAGE_FIXTURE__") {
      return skillPackageFixture;
    }
    return arg;
  });
}

describe("scenario smoke harness", () => {
  for (const scenario of smokeCases) {
    it(`scenario ${scenario.id} runs ${scenario.argv.join(" ")}`, async () => {
      const context = await createTestContext(`scenario-smoke-${scenario.id}`);
      try {
        if (scenario.requiresGitOrigin) {
          initGitRepo(context.projectDir, "git@github.com:acme/smoke.git");
        }
        if (scenario.requiresProjectConfig) {
          writeProjectConfig(context.projectDir);
        }

        const argv = resolveSmokeArgv([...scenario.argv], context);
        const projectFlagIndex = argv.indexOf(".");
        if (projectFlagIndex >= 0 && argv[projectFlagIndex] === ".") {
          argv[projectFlagIndex] = context.projectDir;
        }
        const projectOptionIndex = argv.indexOf("--project");
        if (projectOptionIndex >= 0 && argv[projectOptionIndex + 1] === ".") {
          argv[projectOptionIndex + 1] = context.projectDir;
        }

        if (scenario.id === 1) {
          await runCli(argv);
          return;
        }

        await runCli(["init", "--format", "json"]);
        const result = await runCli(argv);

        if (scenario.expectFailure) {
          expect(result.exitCode).toBe(1);
          return;
        }

        expect(result.exitCode ?? 0).toBe(0);
      } finally {
        await context.cleanup();
      }
    });
  }
});
