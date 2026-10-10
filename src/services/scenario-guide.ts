import { GENERATED_SCENARIOS } from "../generated/scenarios.js";

export interface ScenarioSummary {
  id: number;
  title: string;
  frequency: string | null;
  status: string | null;
}

export interface ScenarioGuide extends ScenarioSummary {
  filename: string;
  summaryLines: string[];
  commands: string[];
}

const SCENARIOS: ScenarioGuide[] = GENERATED_SCENARIOS.map((scenario) => ({
  id: scenario.id,
  filename: scenario.filename,
  title: scenario.title,
  frequency: scenario.frequency,
  status: scenario.status,
  summaryLines: [...scenario.summaryLines],
  commands: [...scenario.commands],
}));

export function listScenarioIds(): number[] {
  return SCENARIOS.map((scenario) => scenario.id);
}

export function listScenarioSummaries(): ScenarioSummary[] {
  return SCENARIOS.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    frequency: scenario.frequency,
    status: scenario.status,
  }));
}

export function loadScenarioGuide(id: number): ScenarioGuide {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Scenario not found: ${id}`);
  }
  return scenario;
}

export function parseScenarioId(input: string): number {
  const id = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(id) || id < 1) {
    throw new Error(`Invalid scenario id: ${input}`);
  }
  return id;
}
