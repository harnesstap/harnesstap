/** Re-export Wave 1 CLI copy from the shared catalog. Parser stays in on-conflict.ts. */

export {
  CLI_ERRORS,
  CLI_HINTS,
  PREVIEW_LABELS,
  SCOPE_COPY,
  ensureErrorPrefix,
  ensureWarningPrefix,
  quoteName,
} from "../copy/cli.js";

export {
  ON_CONFLICT_APPLY_HELP,
  ON_CONFLICT_HELP,
  ON_CONFLICT_PLUGIN_IMPORT_HELP,
  ON_CONFLICT_VALUE_HELP,
} from "./on-conflict.js";
