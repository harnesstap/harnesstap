/**
 * Rule: HarnessTap Desktop never asks the user to run a command. Every action
 * it mentions has a button or flow in the app instead. These patterns spot
 * text that reads like a command instruction (CLI, shell, package manager,
 * flags, or "start the agent" by hand). The guard test scans every Desktop
 * string with them, and agent messages shown in Desktop go through them too.
 */
export const NO_COMMANDS_RULE =
  "HarnessTap Desktop must never ask the user to run a command. Give the action a button or flow in the UI instead.";

export const COMMAND_INSTRUCTION_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "HarnessTap CLI command",
    pattern: /(?:^|[\s`'"(:])(?:ht|harnesstap)\s+(?:--?[a-z]|[a-z][a-z-]+\b)/,
  },
  {
    name: "package manager command",
    pattern: /\b(?:bun|npm|pnpm|yarn)\s+(?:run|install|i|x|exec|add|dlx)\b|\bnpx\s+\S/,
  },
  {
    name: "git command",
    pattern: /\bgit\s+(?:remote\s+(?:add|set-url)|clone|init|pull|push|config|commit|checkout|fetch)\b/,
  },
  {
    name: "terminal instruction",
    pattern: /\b(?:in|from|open|use)\s+(?:a|the|your)\s+terminal\b|\bcommand[ -]line\b|\bshell command\b/i,
  },
  {
    name: "CLI instruction",
    pattern: /\b(?:the|from|in|use|via|with)\s+(?:HarnessTap\s+)?CLI\b/,
  },
  {
    name: "flag hint",
    pattern: /\b(?:run|pass|use|with|without|add|re-run|rerun)\s+`?--[a-z][a-z-]+/i,
  },
  {
    name: "manual agent start",
    pattern: /\bstart\s+(?:the\s+)?(?:HarnessTap\s+)?agent\b|\bagent is running\b|\bsidecar is running\b/i,
  },
  {
    name: "run instruction",
    pattern: /\b(?:Run|Try|Use):?\s+`/,
  },
];

/** The first command-instruction pattern `text` matches, or null. */
export function commandInstructionIn(text: string): string | null {
  for (const { name, pattern } of COMMAND_INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) {
      return name;
    }
  }
  return null;
}
