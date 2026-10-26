/** Read-only Type value for Add marketplace: "Inferred: Claude Code" becomes "Claude Code". */
export function marketplaceTypeReadout(message: string): string {
  return message.replace(/^Inferred:\s*/, "").trim() || message;
}
