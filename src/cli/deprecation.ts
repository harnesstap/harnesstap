import { renderWarn } from "../ui/status.js";

export function warnDeprecatedReplacement(oldName: string, replacement: string): void {
  console.error(renderWarn(`\`${oldName}\` is deprecated. Use \`${replacement}\` instead.`));
}

export function resolveDeprecatedHarnessFlag(input: {
  harness?: string;
  platform?: string;
  commandLabel: string;
}): string | undefined {
  if (input.harness && input.platform) {
    throw new Error("Choose either --harness or --platform, not both.");
  }
  if (input.platform) {
    warnDeprecatedReplacement(`${input.commandLabel} --platform`, `${input.commandLabel} --harness`);
    return input.platform;
  }
  return input.harness;
}
