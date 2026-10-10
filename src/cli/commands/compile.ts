import type { Command } from "commander";
import {
  addApplyCommandOptions,
  type ApplyCommandOpts,
} from "../../services/apply-command-options.js";
import { handleApplyCommand, type ApplyCommandActionOpts } from "./apply.js";
import { resolveProjectCompileTargets } from "../../services/compile-apm.js";
import { previewApmTargets, TargetFlagError } from "../../services/apm-targets.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { resolveUserPath } from "../../utils/user-path.js";
import { ui } from "../../ui/index.js";
import {
  fail,
  failCaught,
  formatCommand,
} from "../shared.js";

export interface TargetsCommandOpts {
  project?: string;
  json?: boolean;
  all?: boolean;
  format?: string;
}

export async function handleCompileCommand(
  extraArgs: string[],
  opts: ApplyCommandActionOpts,
): Promise<void> {
  if (extraArgs.length > 0) {
    process.exitCode = 1;
    fail(
      "ht compile does not take a plugin selector. It reads repo-root apm.yml.",
      {
        hints: [formatCommand("compile"), formatCommand("apply <plugin>")],
      },
    );
    return;
  }

  await handleApplyCommand([], opts);
}

export function handleTargetsCommand(opts: TargetsCommandOpts): void {
  let projectRoot: string;
  try {
    projectRoot = resolveUserPath(opts.project ?? ".", { mustExist: true });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  const format = opts.json ? "json" : parseOutputFormat(opts.format);

  try {
    const resolved = resolveProjectCompileTargets({
      projectRoot,
    });
    const rows = previewApmTargets(resolved, { includeAgentSkills: Boolean(opts.all) });

    if (format === "json") {
      printJson({
        source: resolved.source,
        resolved: resolved.canonicalTargets,
        harnesses: resolved.harnessTargets,
        warnings: resolved.warnings,
        targets: rows,
      });
      return;
    }

    for (const warning of resolved.warnings) {
      ui.warn(warning);
    }

    console.log(
      ui.renderTable({
        columns: [
          { key: "target", header: "TARGET", width: 14 },
          { key: "status", header: "STATUS", width: 10 },
          { key: "source", header: "SOURCE", width: 36 },
          { key: "deployDir", header: "DEPLOY DIR", width: 12 },
        ],
        rows: rows.map((row) => ({
          target: row.target,
          status: row.status,
          source: row.source,
          deployDir: row.deployDir,
        })),
      }),
    );

    if (resolved.source === "empty") {
      ui.info("No target is active. Declare targets: in apm.yml or add a harness config directory.");
    }
  } catch (error) {
    failCaught(error, {
      exitCode: error instanceof TargetFlagError ? 2 : 1,
    });
  }
}

export function registerCompileCommand(root: Command): void {
  const compile = root
    .command("compile")
    .description("Compile local .apm/ primitives into resolved target harness directories")
    .allowExcessArguments(true);
  addApplyCommandOptions(compile);
  compile.action(async (opts: ApplyCommandOpts) => {
    await handleCompileCommand(compile.args, opts);
  });
}

export function registerTargetsCommand(root: Command): void {
  root
    .command("targets")
    .description("Show which apply harness targets resolve for this project, and why")
    .option("--project <path>", "Project directory", ".")
    .option("--json", "Emit machine-readable JSON")
    .option("--all", "Include the agent-skills meta-target row")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((opts: TargetsCommandOpts) => {
      handleTargetsCommand(opts);
    });
}
