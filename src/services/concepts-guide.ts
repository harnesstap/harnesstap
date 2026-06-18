import {
  CANONICAL_CATALOG_BASELINE,
  CANONICAL_CATALOG_SEARCH_HINT,
} from "../constants/onboarding.js";
import {
  listScenarioSummaries,
  type ScenarioSummary,
} from "./scenario-guide.js";
import { ui } from "../ui/index.js";

export interface ConceptsGuidePayload {
  concepts: Array<{ term: string; definition: string }>;
  harness_roles: Array<{ term: string; definition: string }>;
  commands: Array<{ command: string; purpose: string }>;
  environment_cascade: string;
}

export interface HelpCommandPayload {
  concepts: ConceptsGuidePayload;
  scenarios: ScenarioSummary[];
}

export function buildConceptsGuidePayload(): ConceptsGuidePayload {
  return {
    concepts: [
      { term: "resource", definition: "Single canonical item (skill, rule, MCP, hook, agent, …)" },
      { term: "layer", definition: "Named bundle of resources you apply to projects" },
      { term: "profile", definition: "Layer tagged profile; apply globally with profile use" },
      { term: "deck", definition: "Personal curated layer stack; apply with deck apply" },
      { term: "account", definition: "HarnessDeck Cloud login identity stored locally" },
      { term: "environment", definition: "Named how-values (vars, secrets, model config)" },
      { term: "harness", definition: "Target CLI (claude-code, codex, cursor, …)" },
    ],
    harness_roles: [
      { term: "main harness", definition: "Canonical reference for imports and apply" },
      { term: "alias harness", definition: "Mirrors main harness output (symlink or copy)" },
    ],
    commands: [
      {
        command: "layer apply <layer>",
        purpose: "Materialize layer(s) onto a project",
      },
      {
        command: "profile use <profile>",
        purpose: "Apply a profile layer globally to home harness files",
      },
      {
        command: "deck apply <deck>",
        purpose: "Materialize a deck's layer stack onto a project",
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

export function buildHelpCommandPayload(): HelpCommandPayload {
  return {
    concepts: buildConceptsGuidePayload(),
    scenarios: listScenarioSummaries(),
  };
}

function formatCommand(command: string): string {
  return ui.theme.command(command);
}

function printConceptSections(payload: ConceptsGuidePayload): void {
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
}

function printScenarioIndex(scenarios: ScenarioSummary[]): void {
  console.log("");
  ui.subheader("SCENARIOS");
  console.log("");

  const maxIdWidth = Math.max(
    ...scenarios.map((scenario) => String(scenario.id).length),
  );

  for (const scenario of scenarios) {
    const idStr = String(scenario.id).padStart(maxIdWidth);
    const meta = [scenario.frequency, scenario.status].filter(Boolean).join(" · ");
    const metaSuffix = meta.length > 0 ? `  ${ui.theme.muted(meta)}` : "";
    console.log(`  ${idStr}  ${scenario.title}${metaSuffix}`);
  }

  console.log("");
  ui.dim("Run hd help scenario <id> for a scenario playbook.");
}

export function printHelpCommand(): void {
  const payload = buildHelpCommandPayload();
  printConceptSections(payload.concepts);
  printScenarioIndex(payload.scenarios);
}
