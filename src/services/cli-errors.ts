export class CliUsageError extends Error {
  constructor(message: string, readonly hints: string[] = []) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function missingRequiredArg(name: string, commandPath: string): CliUsageError {
  return new CliUsageError(
    `error: missing required argument '${name}'`,
    [`Run \`hd ${commandPath} --help\` for usage.`],
  );
}

export function conflictingOptions(a: string, b: string): CliUsageError {
  return new CliUsageError(`error: cannot use ${a} together with ${b}`);
}
