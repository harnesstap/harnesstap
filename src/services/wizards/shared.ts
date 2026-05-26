import inquirer from "inquirer";

export interface WizardTriggerInput {
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
  missingRequiredArgs: boolean;
}

export function shouldUseWizard(input: WizardTriggerInput): boolean {
  const noInteractive =
    input.noInteractive ?? process.argv.includes("--no-interactive");
  const ciValue = process.env.CI?.trim().toLowerCase();
  const ciEnabled = Boolean(
    ciValue && ciValue !== "0" && ciValue !== "false" && ciValue !== "no",
  );

  return Boolean(
    process.stdin.isTTY
      && process.stdout.isTTY
      && !ciEnabled
      && process.env.HARNESSDECK_NO_INTERACTIVE !== "1"
      && !noInteractive
      && input.format !== "json"
      && (input.interactive || input.missingRequiredArgs),
  );
}

export async function resolveOrPrompt<T>(input: {
  value: T | undefined;
  shouldPrompt: boolean;
  prompt: () => Promise<T>;
}): Promise<T | undefined> {
  if (input.value !== undefined) {
    return input.value;
  }

  if (!input.shouldPrompt) {
    return undefined;
  }

  return input.prompt();
}

export async function promptForValue(input: {
  message: string;
  default?: string;
}): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: "input",
      name: "value",
      message: input.message,
      default: input.default,
      validate: (candidate: string) =>
        candidate.trim().length > 0 ? true : "A value is required.",
    },
  ]);

  return value.trim();
}
