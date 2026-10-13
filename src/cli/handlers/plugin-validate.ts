import { loadSpecPackagePath } from "../../services/agent-plugins/spec-load.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export function handlePluginValidateCommand(
  file: string,
  opts: { spec?: string; format?: string },
): void {
  const format = parseOutputFormat(opts.format);
  const report = loadSpecPackagePath(file, opts.spec ?? "1.0.0");
  if (format === "json") {
    printJson(report);
  } else if (!report.ok) {
    ui.danger(report.rejected ?? "Invalid Agent Plugins package");
  } else {
    ui.success(`${report.name}@${report.version}`);
    ui.info(`skills: ${report.loaded.skills.join(", ") || "(none)"}`);
    ui.info(`mcp servers: ${report.loaded.mcpServers.join(", ") || "(none)"}`);
    for (const item of report.skipped) {
      ui.warn(`skipped ${item.component} ${item.name}: ${item.reason}`);
    }
    for (const item of report.reported) {
      ui.warn(`${item.field}: ${item.message}`);
    }
    if (report.mcpDisabled) {
      ui.warn(`MCP disabled: ${report.mcpDisabled}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}
