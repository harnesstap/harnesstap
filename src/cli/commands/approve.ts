import type { Command } from "commander";
import { resolve } from "node:path";
import {
  buildExecutableTrustContext,
  formatApproveRemedy,
  installedTrustReports,
  pendingRefs,
  recommendRefs,
  writeProjectExecutableGrant,
  writeUserExecutableGrant,
  type PackageTrustReport,
} from "../../services/executable-trust.js";
import { readLockfile } from "../../services/lockfile.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { formatCommand } from "../shared.js";

export interface ApproveCommandOpts {
  project?: string;
  user?: boolean;
  pending?: boolean;
  all?: boolean;
  recommended?: boolean;
  list?: boolean;
  format?: string;
}

function layerLabel(report: PackageTrustReport): string {
  const deciding = report.decisions
    .filter((decision) => report.gatedTypes.includes(decision.type))
    .map((decision) => decision.layer);
  return deciding[0] ?? "none";
}

function printReports(reports: PackageTrustReport[]): void {
  if (reports.length === 0) {
    ui.info("No installed dependency packages");
    return;
  }
  for (const report of reports) {
    const types = report.gatedTypes.length > 0 ? report.gatedTypes.join(", ") : "none";
    ui.info(
      `${report.ref}  ${report.execStatus}  ${types}  layer ${layerLabel(report)}`,
    );
  }
}

function exclusiveFlags(opts: ApproveCommandOpts): string[] {
  return [
    opts.pending ? "--pending" : undefined,
    opts.all ? "--all" : undefined,
    opts.recommended ? "--recommended" : undefined,
    opts.list ? "--list" : undefined,
  ].filter((value): value is string => value !== undefined);
}

export function handleApproveCommand(refs: string[], opts: ApproveCommandOpts): void {
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project ?? ".");
  const flags = exclusiveFlags(opts);
  if (flags.length > 1) {
    process.exitCode = 1;
    ui.danger(`Use only one of ${flags.join(", ")}`);
    return;
  }

  const context = buildExecutableTrustContext({ projectRoot });
  const lock = readLockfile(projectRoot);
  const reports = installedTrustReports(context, { ...(lock ? { lock } : {}) });

  if (opts.list) {
    if (format === "json") {
      printJson({ packages: reports });
      return;
    }
    printReports(reports);
    return;
  }

  if (opts.pending) {
    const pending = reports.filter((report) => report.execStatus === "gated_pending_approval");
    if (format === "json") {
      printJson({ pending: pending.map((report) => report.ref) });
      return;
    }
    if (pending.length === 0) {
      ui.success("No packages awaiting approval");
      return;
    }
    for (const report of pending) {
      ui.info(`${report.ref}  ${report.gatedTypes.join(", ")}`);
    }
    ui.hint(formatApproveRemedy(pending.map((report) => report.ref)));
    return;
  }

  let targets = refs;
  if (opts.all) {
    targets = pendingRefs(reports);
    if (targets.length === 0) {
      ui.success("No packages awaiting approval");
      return;
    }
  } else if (opts.recommended) {
    targets = recommendRefs(context.org);
    if (targets.length === 0) {
      ui.info("No org-recommended packages");
      return;
    }
  }

  if (targets.length === 0) {
    process.exitCode = 1;
    ui.danger("Provide a package ref, or use --pending, --all, --recommended, or --list", {
      hints: [formatCommand("approve --pending"), formatCommand("approve owner/repo")],
    });
    return;
  }

  if (opts.user) {
    writeUserExecutableGrant({ side: "allow", refs: targets });
  } else {
    writeProjectExecutableGrant({ projectRoot, side: "allow", refs: targets });
  }

  if (format === "json") {
    printJson({
      written: opts.user ? "user" : "project",
      side: "allow",
      refs: targets,
    });
    return;
  }
  ui.success(
    `Approved ${targets.join(", ")} in ${opts.user ? "~/.harnesstap/config.jsonc" : "apm.yml"}`,
  );
}

export function registerApproveCommand(root: Command): void {
  root
    .command("approve")
    .description("Approve executable primitives from dependency packages")
    .argument("[PACKAGE_REF...]", "Packages to approve (owner/repo)")
    .option("--project <path>", "Project directory", ".")
    .option("--user", "Write ~/.harnesstap/config.jsonc instead of apm.yml")
    .option("--pending", "List packages with unapproved executables")
    .option("--all", "Approve all currently pending packages")
    .option("--recommended", "Approve the org executables.recommend set")
    .option("--list", "Show effective trust decision per installed package")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((refs: string[], opts: ApproveCommandOpts) => {
      handleApproveCommand(refs, opts);
    });
}

export function handleDenyCommand(refs: string[], opts: ApproveCommandOpts): void {
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project ?? ".");
  if (opts.pending || opts.all || opts.recommended || opts.list) {
    process.exitCode = 1;
    ui.danger("ht deny writes a deny grant; use ht approve --pending/--list to inspect");
    return;
  }
  if (refs.length === 0) {
    process.exitCode = 1;
    ui.danger("Provide one or more package refs to deny", {
      hints: [formatCommand("deny owner/repo"), formatCommand("deny --user owner/repo")],
    });
    return;
  }

  if (opts.user) {
    writeUserExecutableGrant({ side: "deny", refs });
  } else {
    writeProjectExecutableGrant({ projectRoot, side: "deny", refs });
  }

  if (format === "json") {
    printJson({
      written: opts.user ? "user" : "project",
      side: "deny",
      refs,
    });
    return;
  }
  ui.success(
    `Denied ${refs.join(", ")} in ${opts.user ? "~/.harnesstap/config.jsonc" : "apm.yml"}`,
  );
}

export function registerDenyCommand(root: Command): void {
  root
    .command("deny")
    .description("Deny executable primitives from dependency packages")
    .argument("[PACKAGE_REF...]", "Packages to deny (owner/repo)")
    .option("--project <path>", "Project directory", ".")
    .option("--user", "Write ~/.harnesstap/config.jsonc instead of apm.yml")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((refs: string[], opts: ApproveCommandOpts) => {
      handleDenyCommand(refs, opts);
    });
}
