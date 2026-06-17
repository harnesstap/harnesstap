import type { Command } from "commander";
import { closeDb } from "../../db/connection.js";
import { completeLine } from "./engine.js";
import type { CompletionCandidate } from "./types.js";

const COMPLETE_CACHE_TTL_MS = 100;

type CompleteCacheEntry = {
  key: string;
  expiresAt: number;
  candidates: CompletionCandidate[];
};

let completeCache: CompleteCacheEntry | undefined;

function formatCandidates(
  candidates: CompletionCandidate[],
  shell: string,
): string {
  if (candidates.length === 0) {
    return "";
  }

  const lines = candidates.map((candidate) => {
    if ((shell === "zsh" || shell === "fish") && candidate.description) {
      return `${candidate.value}\t${candidate.description}`;
    }
    return candidate.value;
  });

  return `${lines.join("\n")}\n`;
}

export async function runCompleteCommand(
  shell: string,
  lineParts: string[],
  program: Command,
): Promise<void> {
  const previousComplete = process.env.HARNESSDECK_COMPLETE;
  closeDb();
  process.env.HARNESSDECK_COMPLETE = "1";
  process.exitCode = 0;

  try {
    const line = lineParts.filter((part) => part !== "--").join(" ");
    const now = Date.now();
    const cacheKey = line;
    const cached =
      completeCache?.key === cacheKey && completeCache.expiresAt > now
        ? completeCache.candidates
        : undefined;
    const candidates =
      cached ?? (await completeLine(program, line));
    if (!cached) {
      completeCache = {
        key: cacheKey,
        expiresAt: now + COMPLETE_CACHE_TTL_MS,
        candidates,
      };
    }
    process.stdout.write(formatCandidates(candidates, shell));
  } catch {
    // Errors produce empty completion output.
  } finally {
    closeDb();
    if (previousComplete === undefined) {
      delete process.env.HARNESSDECK_COMPLETE;
    } else {
      process.env.HARNESSDECK_COMPLETE = previousComplete;
    }
  }
}
