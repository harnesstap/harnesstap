import { commandInstructionIn } from "./command-instructions";
import type { RecoveryAction } from "./types";

/**
 * The agent and core share message text with the CLI, so some of it tells the
 * reader to run a command. Desktop never shows that (see NO_COMMANDS_RULE):
 * known messages map to Desktop copy that points at the UI, and anything else
 * drops the sentences that read like a command instruction.
 */
export const AGENT_MESSAGE_FALLBACK = "Something went wrong in the HarnessTap agent. Try again.";

const DESKTOP_REWRITES: readonly { match: RegExp; text: string }[] = [
  {
    match: /^No harness targets configured\b/,
    text: "No harness is set up for this project. Open Harnesses and select Detect.",
  },
];

function splitSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z`])/);
}

/** Agent text made safe for Desktop: mapped copy, or the text minus command sentences. */
export function desktopAgentText(message: string, fallback = AGENT_MESSAGE_FALLBACK): string {
  const trimmed = message.trim();
  for (const rewrite of DESKTOP_REWRITES) {
    if (rewrite.match.test(trimmed)) {
      return rewrite.text;
    }
  }
  if (!commandInstructionIn(trimmed)) {
    return message;
  }
  const lines = message
    .split("\n")
    .map((line) => {
      const indent = line.match(/^\s*/)?.[0] ?? "";
      const kept = splitSentences(line.trim()).filter(
        (sentence) => sentence.length > 0 && !commandInstructionIn(sentence),
      );
      return kept.length > 0 ? `${indent}${kept.join(" ")}` : null;
    })
    .filter((line): line is string => line !== null && !/^\s*fix:\s*$/.test(line));
  const result = lines.join("\n").trim();
  return result.length > 0 ? result : fallback;
}

/** Button label for a recovery action, without the CLI wording the agent may use. */
export function recoveryActionLabel(action: RecoveryAction): string {
  if (!commandInstructionIn(action.label)) {
    return action.label;
  }
  switch (action.id) {
    case "sync-install":
      if (action.sourceKind === "git") {
        return `Fetch ${action.pluginName}`;
      }
      if (action.sourceKind === "catalog") {
        return `Pull ${action.pluginName} from catalog`;
      }
      return `Install ${action.pluginName}`;
    case "create-plugin":
      return `Create ${action.pluginName}`;
    case "override-version":
      return `Override ${action.pluginName} to an available version`;
    case "override-resource":
      return `Use ${action.winnerPluginName} for ${action.key}`;
    case "detach-dependency":
      return `Detach ${action.pluginName} from ${action.rootName}`;
    case "clear-override":
      return `Clear override for ${action.pluginName}`;
    case "tag-as-profile":
      return `Tag ${action.pluginName} as a profile`;
    default: {
      const unknown: never = action;
      return (unknown as { label: string }).label;
    }
  }
}
