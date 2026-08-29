import type { Command } from "commander";
import { resolve } from "node:path";
import {
  buildExecutableTrustContext,
  evaluateExecutableType,
  exactGrantMatch,
  EXEC_TYPES,
  execStatusFromDecisions,
  installedTrustReports,
  type PackageTrustReport,
} from "../../services/executable-trust.js";
import { readLockfile } from "../../services/lockfile.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";

export interface PolicyExplainOpts {
  project?: string;
  format?: string;
}

function shadowedLine(decision: PackageTrustReport["decisions"][number]): string {
  if (decision.shadowed.length === 0) {
    return "none";
  }
  return decision.shadowed
    .map((entry) => `${entry.layer} (${entry.outcome})`)
    .join(", ");
}

function printExplain(report: PackageTrustReport, optedIn: boolean): void {
  if (!optedIn) {
    ui.info(`${report.ref}  gate off`);
    return;
  }
  ui.info(`${report.ref}  ${report.execStatus}`);
  const types = report.gatedTypes.length > 0 ? report.gatedTypes : EXEC_TYPES;
  for (const type of types) {
    const decision = report.decisions.find((entry) => entry.type === type);
    if (!decision) continue;
    ui.info(
      `  ${type}  ${decision.outcome}  layer ${decision.layer}  shadowed ${shadowedLine(decision)}`,
    );
  }
}

function reportForRef(
  packageRef: string,
  installed: PackageTrustReport[],
  context: ReturnType<typeof buildExecutableTrustContext>,
): PackageTrustReport {
  const existing = installed.find((entry) =>
    exactGrantMatch(packageRef, [entry.ref, entry.name, ...entry.identities]),
  );
  if (existing) {
    return existing;
  }
  const identities = [packageRef];
  const decisions = EXEC_TYPES.map((type) => evaluateExecutableType(context, identities, type));
  return {
    ref: packageRef,
    name: packageRef,
    version: "",
    identities,
    gatedTypes: [...EXEC_TYPES],
    decisions,
    execStatus: execStatusFromDecisions([...EXEC_TYPES], decisions),
  };
}

export function handlePolicyExplainCommand(
  packageRef: string,
  opts: PolicyExplainOpts,
): void {
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project ?? ".");
  const context = buildExecutableTrustContext({ projectRoot });
  const lock = readLockfile(projectRoot);
  const installed = installedTrustReports(context, { ...(lock ? { lock } : {}) });
  const report = reportForRef(packageRef, installed, context);

  if (format === "json") {
    printJson({
      ref: report.ref,
      name: report.name,
      version: report.version,
      exec_status: report.execStatus,
      opted_in: context.optedIn,
      deciding_layer: report.decisions[0]?.layer,
      decisions: report.decisions,
      warnings: context.warnings,
    });
    return;
  }
  for (const warning of context.warnings) {
    ui.warn(warning);
  }
  printExplain(report, context.optedIn);
}

export function registerPolicyCommands(root: Command): void {
  const policy = root
    .command("policy")
    .description("Inspect executable-trust and apm-policy.yml decisions");

  policy
    .command("explain")
    .description("Print the effective executable-trust decision for a package")
    .argument("<PACKAGE_REF>", "Package to explain (owner/repo)")
    .option("--project <path>", "Project directory", ".")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((ref: string, explainOpts: PolicyExplainOpts) => {
      handlePolicyExplainCommand(ref, explainOpts);
    });
}
