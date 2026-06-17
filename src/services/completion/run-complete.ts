import type { Command } from "commander";
import { completeLine } from "./engine.js";
import type { CompletionCandidate } from "./types.js";

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
  process.env.HARNESSDECK_COMPLETE = "1";
  process.exitCode = 0;

  try {
    const line = lineParts.filter((part) => part !== "--").join(" ");
    const candidates = await completeLine(program, line);
    process.stdout.write(formatCandidates(candidates, shell));
  } catch {
    // Errors produce empty completion output.
  }
}
