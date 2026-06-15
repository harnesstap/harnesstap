import { join } from "node:path";
import type { DeckJson } from "../types.js";
import { readDeckToml } from "./exporter.js";
import { generatedManifestsCheck } from "./deck-doctor/checks/generated-manifests.js";
import type {
  DeckDoctorCheck,
  DeckDoctorContext,
  DeckDoctorResult,
} from "./deck-doctor/deck-doctor.types.js";

const deckDoctorChecks: DeckDoctorCheck[] = [generatedManifestsCheck];

function readDeckTomlFromRepo(repoRoot: string): DeckJson {
  const deckTomlPath = join(repoRoot, ".harnessdeck", "deck.toml");
  try {
    return readDeckToml(deckTomlPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid .harnessdeck/deck.toml: ${message}`);
  }
}

function createDeckDoctorContext(repoRoot: string): DeckDoctorContext {
  return {
    repoRoot,
    deckJson: readDeckTomlFromRepo(repoRoot),
  };
}

export function listDeckDoctorChecks(): DeckDoctorCheck[] {
  return [...deckDoctorChecks];
}

export async function runDeckDoctor(input: {
  repoRoot: string;
  checkIds?: string[];
}): Promise<{
  repoRoot: string;
  valid: boolean;
  checks: string[];
  results: DeckDoctorResult[];
}> {
  const context = createDeckDoctorContext(input.repoRoot);
  const requestedChecks = input.checkIds?.length ? new Set(input.checkIds) : null;
  const checks = deckDoctorChecks.filter(
    (check) => requestedChecks?.has(check.id) ?? true,
  );

  if (requestedChecks) {
    const knownCheckIds = new Set(deckDoctorChecks.map((check) => check.id));
    for (const checkId of requestedChecks) {
      if (!knownCheckIds.has(checkId)) {
        throw new Error(`Unknown doctor check: ${checkId}`);
      }
    }
  }

  const results: DeckDoctorResult[] = [];
  for (const check of checks) {
    const checkResults = await check.run(context);
    for (const result of checkResults) {
      results.push({
        check: check.id,
        ...result,
      });
    }
  }

  return {
    repoRoot: context.repoRoot,
    valid: !results.some((result) => result.severity === "error"),
    checks: checks.map((check) => check.id),
    results,
  };
}

export type {
  DeckDoctorCheck,
  DeckDoctorResult,
} from "./deck-doctor/deck-doctor.types.js";
