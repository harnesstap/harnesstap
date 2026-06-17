export type CompletionSlot = "subcommand" | "flag" | "flag-value" | "positional";

export type CompletionContext = {
  commandPath: string[];
  slot: CompletionSlot;
  flag?: string;
  positionalIndex?: number;
  consumedPositionals?: string[];
  prefix: string;
  profile?: string;
  localDataAvailable: boolean;
};

export type CompletionCandidate = {
  value: string;
  description?: string;
};

export type CompletionProvider = (
  ctx: CompletionContext,
) => CompletionCandidate[] | Promise<CompletionCandidate[]>;
