import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}

const root = join(import.meta.dir, "../..");
const workflow = parse(readFileSync(join(root, ".github/workflows/homebrew-tap.yml"), "utf8")) as {
  on: { workflow_call: { secrets: Record<string, unknown> }; workflow_dispatch: unknown };
  jobs: { update: { steps: Step[] } };
};
const steps = workflow.jobs.update.steps;
const checkStep = steps.find((step) => step.id === "check") as Step;

function runCheck(env: Record<string, string>): { output: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "ht-tap-wf-"));
  const outputFile = join(dir, "output");
  // Actions sets an unset secret or variable to an empty string, not unset.
  const step = { APP_CLIENT_ID: "", APP_PRIVATE_KEY: "", GH_TOKEN: "", ...env };
  const result = spawnSync("bash", ["-c", checkStep.run as string], {
    env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: outputFile, RUNNER_TEMP: dir, ...step },
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return { output: readFileSync(outputFile, "utf8"), stdout: result.stdout };
}

describe("homebrew-tap workflow", () => {
  it("skips with a notice when the tap app credentials are missing", () => {
    for (const env of [
      { TAG: "v1.6.1" },
      { TAG: "v1.6.1", APP_CLIENT_ID: "Iv23example" },
      { TAG: "v1.6.1", APP_PRIVATE_KEY: "key" },
    ]) {
      const { output, stdout } = runCheck(env);
      expect(output.trim()).toBe("run=false");
      expect(stdout).toContain("::notice::");
      expect(stdout).toContain("HOMEBREW_TAP_APP_PRIVATE_KEY");
    }
  });

  it("skips tags that are not stable releases before calling GitHub", () => {
    const { output, stdout } = runCheck({
      TAG: "v1.7.0-beta.1",
      APP_CLIENT_ID: "Iv23example",
      APP_PRIVATE_KEY: "key",
    });
    expect(output.trim()).toBe("run=false");
    expect(stdout).toContain("not a stable vX.Y.Z tag");
  });

  it("mints a token limited to contents:write on the tap repo and uses it for the checkout", () => {
    const mint = steps.find((step) => step.id === "app-token") as Step;
    expect(mint.uses).toStartWith("actions/create-github-app-token@");
    expect(mint.with).toEqual({
      "client-id": "${{ vars.HOMEBREW_TAP_APP_CLIENT_ID }}",
      "private-key": "${{ secrets.HOMEBREW_TAP_APP_PRIVATE_KEY }}",
      owner: "harnesstap",
      repositories: "homebrew-tap",
      "permission-contents": "write",
    });
    const checkout = steps.find((step) => step.name === "Check out tap") as Step;
    expect(checkout.with?.token).toBe("${{ steps.app-token.outputs.token }}");
    expect(Object.keys(workflow.on.workflow_call.secrets)).toEqual(["HOMEBREW_TAP_APP_PRIVATE_KEY"]);
    expect(workflow.on.workflow_dispatch).toBeDefined();
  });
});
