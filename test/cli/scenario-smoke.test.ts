import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

interface ScenarioSmokeCase {
  id: number;
  argv: string[];
  requiresGitOrigin?: boolean;
  expectFailure?: boolean;
}

const repoRoot = join(import.meta.dirname, "../..");
const smokeCases = JSON.parse(
  readFileSync(join(repoRoot, "docs/scenarios/scenario-smoke.json"), "utf-8"),
) as ScenarioSmokeCase[];

describe("scenario smoke harness", () => {
  for (const scenario of smokeCases) {
    it(`scenario ${scenario.id} runs ${scenario.argv.join(" ")}`, async () => {
      const context = await createTestContext(`scenario-smoke-${scenario.id}`);
      try {
        if (scenario.requiresGitOrigin) {
          initGitRepo(context.projectDir, "git@github.com:acme/smoke.git");
        }

        const argv = [...scenario.argv];
        const projectFlagIndex = argv.indexOf(".");
        if (projectFlagIndex >= 0 && argv[projectFlagIndex] === ".") {
          argv[projectFlagIndex] = context.projectDir;
        }
        const projectOptionIndex = argv.indexOf("--project");
        if (projectOptionIndex >= 0 && argv[projectOptionIndex + 1] === ".") {
          argv[projectOptionIndex + 1] = context.projectDir;
        }

        if (scenario.id === 28) {
          const outIndex = argv.indexOf("__MIGRATE_OUT__");
          if (outIndex >= 0) {
            argv[outIndex] = join(context.rootDir, "migrate-smoke.json");
          }
        }

        if (scenario.id === 17) {
          const archiveIndex = argv.indexOf("__MISSING_ARCHIVE__");
          if (archiveIndex >= 0) {
            argv[archiveIndex] = join(context.rootDir, "missing-migrate-archive.tar.gz");
          }
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
