import {
  CANONICAL_CATALOG_BASELINE,
  CANONICAL_CATALOG_SEARCH_HINT,
} from "../constants/onboarding.js";
import { ui } from "../ui/index.js";

function formatCommand(command: string): string {
  return ui.theme.command(command);
}

export function printConceptsGuide(): void {
  console.log("");
  ui.subheader("CORE CONCEPTS");
  console.log("");
  console.log("  resource   Single canonical item (skill, rule, MCP, hook, agent, …)");
  console.log("  layer      Named bundle of resources you apply to projects");
  console.log("  deck       Portable git repo with .harnessdeck/deck.json");
  console.log("  environment  Named how-values (vars, secrets, model config)");
  console.log("  harness    Target CLI (claude-code, codex, cursor, …)");
  console.log("");
  ui.subheader("HARNESS ROLES");
  console.log("");
  console.log("  main harness   Canonical reference for imports and apply");
  console.log("  alias harness  Mirrors main harness output (symlink or copy)");
  console.log("");
  ui.subheader("COMMON COMMANDS");
  console.log("");
  console.log(
    `  ${formatCommand("project apply <layer> --project .")}  Materialize a layer onto disk`,
  );
  console.log(
    `  ${formatCommand("project mirror .")}  Sync alias harnesses from on-disk main`,
  );
  console.log(
    `  ${formatCommand(`layer search ${CANONICAL_CATALOG_SEARCH_HINT}`)}  Browse public catalog layers`,
  );
  console.log(
    `  ${formatCommand(`layer pull org/catalog/${CANONICAL_CATALOG_BASELINE}`)}  Cache a catalog layer locally`,
  );
  console.log(
    `  ${formatCommand("layer combine <layer> <item> --type skill")}  Add a local resource to a layer`,
  );
  console.log("");
  ui.subheader("ENVIRONMENT CASCADE");
  console.log("");
  console.log("  home env ◂ layer default env ◂ deck active env  (last wins on apply)");
  console.log("");
  ui.dim("Run hd guide for quick-start commands and documentation links.");
}
