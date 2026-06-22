export type PromptScreen = {
  enter(): void;
  render(content: string): void;
  exit(): void;
};

export function createPromptScreen(opts: {
  isTty?: boolean;
  output?: NodeJS.WritableStream;
} = {}): PromptScreen {
  const output = opts.output ?? process.stdout;
  const isTty =
    opts.isTty ??
    ("isTTY" in output && (output as NodeJS.WriteStream).isTTY === true);
  const enterSeq = "\x1b[?1049h";
  const exitSeq = "\x1b[?1049l";

  return {
    enter() {
      if (isTty) {
        output.write(enterSeq);
      }
    },
    render(content: string) {
      output.write(content);
    },
    exit() {
      if (isTty) {
        output.write(exitSeq);
      }
    },
  };
}
