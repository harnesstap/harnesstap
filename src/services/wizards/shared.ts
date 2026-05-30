import inquirer from "inquirer";
import search from "@inquirer/search";

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

export async function promptForOptionalValue(input: {
  message: string;
  default?: string;
}): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: "input",
      name: "value",
      message: input.message,
      default: input.default,
    },
  ]);

  return value.trim();
}

export interface PromptChoice<T extends string = string> {
  name: string;
  value: T;
}

function promptPageSize(choiceCount: number): number {
  return Math.min(Math.max(choiceCount, 5), 12);
}

export async function promptForChoice<T extends string>(input: {
  message: string;
  choices: PromptChoice<T>[];
  default?: T;
}): Promise<T> {
  const { value } = await inquirer.prompt<{ value: T }>([
    {
      type: "list",
      name: "value",
      message: input.message,
      default: input.default,
      choices: input.choices,
      pageSize: promptPageSize(input.choices.length),
      loop: false,
    },
  ]);

  return value;
}

function sortChoicesWithDefaultFirst<T extends string>(
  choices: PromptChoice<T>[],
  defaultValue?: T,
): PromptChoice<T>[] {
  if (!defaultValue) {
    return choices;
  }

  const defaultChoice = choices.find((choice) => choice.value === defaultValue);
  if (!defaultChoice) {
    return choices;
  }

  return [
    defaultChoice,
    ...choices.filter((choice) => choice.value !== defaultValue),
  ];
}

export async function promptForSearchableChoice<T extends string>(input: {
  message: string;
  choices: PromptChoice<T>[];
  default?: T;
}): Promise<T> {
  return search<T>({
    message: input.message,
    pageSize: promptPageSize(input.choices.length),
    source: async (term) => {
      const normalizedTerm = term?.trim().toLowerCase();
      const choices = sortChoicesWithDefaultFirst(input.choices, input.default);
      if (!normalizedTerm) {
        return choices;
      }

      return choices.filter((choice) =>
        `${choice.name} ${choice.value}`.toLowerCase().includes(normalizedTerm),
      );
    },
  });
}

export async function promptForConfirmation(input: {
  message: string;
  default?: boolean;
}): Promise<boolean> {
  const { value } = await inquirer.prompt<{ value: boolean }>([
    {
      type: "confirm",
      name: "value",
      message: input.message,
      default: input.default ?? false,
    },
  ]);

  return value;
}
