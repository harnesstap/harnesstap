import { resolve } from "node:path";
import { renderCliError } from "../runtime.js";
import { validateApPackagePath } from "../../services/agent-plugins/validate-package.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export function handlePluginValidatePackageCommand(
  file: string,
  opts: { strict?: boolean; format?: string },
): void {
  const format = parseOutputFormat(opts.format);
  try {
    const result = validateApPackagePath(resolve(file), { strict: Boolean(opts.strict) });
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(`Valid Agent Plugins package ${result.name}@${result.version}`);
    if (result.schemaDefaulted) {
      ui.dim(`plugin.json had no $schema; accepted with default ${result.schema}`);
    }
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    if (format === "json") {
      printJson({ ok: false, error: message });
      return;
    }
    renderCliError(error);
  }
}
