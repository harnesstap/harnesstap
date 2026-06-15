import {
  CANONICAL_CATALOG_BASELINE,
  CANONICAL_CATALOG_SEARCH_HINT,
} from "../constants/onboarding.js";
import { ui } from "../ui/index.js";

export interface ConceptsGuidePayload {
  concepts: Array<{ term: string; definition: string }>;
  harness_roles: Array<{ term: string; definition: string }>;
  commands: Array<{ command: string; purpose: string }>;
  environment_cascade: string;
}

export function buildConceptsGuidePayload(): ConceptsGuidePayload {
  return {
    concepts: [
      { term: "resource", definition: "Single canonical item (skill, rule, MCP, hook, agent, …)" },
      { term: "layer", definition: "Named bundle of resources you apply to projects" },
      { term: "deck", definition: "Portable git repo with .harnessdeck/deck.toml" },
      { term: "environment", definition: "Named how-values (vars, secrets, model config)" },
      { term: "harness", definition: "Target CLI (claude-code, codex, cursor, …)" },
    ],
    harness_roles: [
      { term: "main harness", definition: "Canonical reference for imports and apply" },
      { term: "alias harness", definition: "Mirrors main harness output (symlink or copy)" },
    ],
    commands: [
      {
        command: "project apply <layer>",
        purpose: "Materialize a layer onto disk",
      },
      {
        command: "project mirror .",
        purpose: "Sync alias harnesses from on-disk main",
      },
      {
        command: `layer search ${CANONICAL_CATALOG_SEARCH_HINT}`,
        purpose: "Browse public catalog layers",
      },
      {
        command: `layer pull org/catalog/${CANONICAL_CATALOG_BASELINE}`,
        purpose: "Cache a catalog layer locally",
      },
      {
        command: "layer combine <layer> <item> --type skill",
        purpose: "Add a local resource to a layer",
      },
    ],
    environment_cascade: "home env ◂ layer default env ◂ deck active env (last wins on apply)",
  };
}

function formatCommand(command: string): string {
  return ui.theme.command(command);
}

export function printConceptsGuide(): void {
  const payload = buildConceptsGuidePayload();
  console.log("");
  ui.subheader("CORE CONCEPTS");
  console.log("");
  for (const entry of payload.concepts) {
    console.log(`  ${entry.term.padEnd(13)} ${entry.definition}`);
  }
  console.log("");
  ui.subheader("HARNESS ROLES");
  console.log("");
  for (const entry of payload.harness_roles) {
    console.log(`  ${entry.term.padEnd(13)} ${entry.definition}`);
  }
  console.log("");
  ui.subheader("COMMON COMMANDS");
  console.log("");
  for (const entry of payload.commands) {
    console.log(`  ${formatCommand(entry.command)}  ${entry.purpose}`);
  }
  console.log("");
  ui.subheader("ENVIRONMENT CASCADE");
  console.log("");
  console.log(`  ${payload.environment_cascade}`);
  console.log("");
  ui.dim("Run hd guide for quick-start commands and documentation links.");
}
