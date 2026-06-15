import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SCENARIOS_DETAILS_DIR = resolve(
  import.meta.dirname,
  "../../docs/scenarios/details",
);

export interface ScenarioGuide {
  id: number;
  filename: string;
  title: string;
  frequency: string | null;
  status: string | null;
  summaryLines: string[];
  commands: string[];
}

function scenarioDetailPath(id: number): string | undefined {
  const prefix = `${String(id).padStart(2, "0")}-`;
  const match = readdirSync(SCENARIOS_DETAILS_DIR).find((name) =>
    name.startsWith(prefix) && name.endsWith(".md"),
  );
  if (!match) {
    return undefined;
  }
  return join(SCENARIOS_DETAILS_DIR, match);
}

function extractBashCommands(markdown: string): string[] {
  const commands: string[] = [];
  const blockPattern = /```bash\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(blockPattern)) {
    const block = match[1];
    if (!block) {
      continue;
    }
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      commands.push(trimmed);
    }
  }
  return commands;
}

export function listScenarioIds(): number[] {
  return readdirSync(SCENARIOS_DETAILS_DIR)
    .map((name) => {
      const match = /^(\d{2})-/.exec(name);
      return match?.[1] ? Number.parseInt(match[1], 10) : null;
    })
    .filter((id): id is number => id != null)
    .sort((left, right) => left - right);
}

export function loadScenarioGuide(id: number): ScenarioGuide {
  const path = scenarioDetailPath(id);
  if (!path || !existsSync(path)) {
    throw new Error(`Scenario not found: ${id}`);
  }

  const markdown = readFileSync(path, "utf-8");
  const titleMatch = /^# Scenario \d+:\s*(.+)$/m.exec(markdown);
  const metaMatch =
    /^\*\*Frequency:\s*([^*]+)\*\*\s*·\s*\*\*Status:\s*([^*]+)\*\*/m.exec(
      markdown,
    );

  const summaryBlock = markdown
    .slice(0, markdown.indexOf("Typical commands:"))
    .split("\n")
    .slice(4)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("["));

  return {
    id,
    filename: path.split("/").pop() ?? String(id),
    title: titleMatch?.[1]?.trim() ?? `Scenario ${id}`,
    frequency: metaMatch?.[1]?.trim() ?? null,
    status: metaMatch?.[2]?.trim() ?? null,
    summaryLines: summaryBlock,
    commands: extractBashCommands(markdown),
  };
}

export function parseScenarioId(input: string): number {
  const id = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(id) || id < 1) {
    throw new Error(`Invalid scenario id: ${input}`);
  }
  return id;
}
