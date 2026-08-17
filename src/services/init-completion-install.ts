import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { ui } from "../ui/index.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { renderShellCompletion } from "./shell-completion.js";
import { promptForConfirmation } from "./wizards/shared.js";

export type SupportedCompletionShell = "bash" | "zsh" | "fish";

export const COMPLETION_MARKERS: Record<SupportedCompletionShell, string> = {
  bash: "# harnesstap bash completion",
  zsh: "#compdef ht harnesstap",
  fish: "# harnesstap fish completion",
};

export function detectShellFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupportedCompletionShell | undefined {
  const base = (env.SHELL ?? "").split("/").pop()?.toLowerCase();
  if (base === "bash" || base === "zsh" || base === "fish") return base;
  return undefined;
}

export function resolveCompletionTargetPath(
  shell: SupportedCompletionShell,
  homeRoot: string,
): string {
  switch (shell) {
    case "bash":
      return join(homeRoot, ".bashrc");
    case "zsh":
      return join(homeRoot, ".zshrc");
    case "fish":
      return join(homeRoot, ".config", "fish", "completions", "ht.fish");
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
}

export function completionAlreadyInstalled(
  shell: SupportedCompletionShell,
  contents: string,
): boolean {
  return contents.includes(COMPLETION_MARKERS[shell]);
}

export type InstallShellCompletionResult =
  | { status: "installed"; path: string }
  | { status: "already_installed"; path: string };

export async function installShellCompletion(input: {
  shell: SupportedCompletionShell;
  homeRoot: string;
  script: string;
}): Promise<InstallShellCompletionResult> {
  const path = resolveCompletionTargetPath(input.shell, input.homeRoot);
  await mkdir(dirname(path), { recursive: true });

  if (input.shell === "fish") {
    if (existsSync(path)) {
      const existing = await readFile(path, "utf8");
      if (completionAlreadyInstalled("fish", existing)) {
        return { status: "already_installed", path };
      }
    }
    await writeFile(path, input.script.endsWith("\n") ? input.script : `${input.script}\n`, "utf8");
    return { status: "installed", path };
  }

  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  if (completionAlreadyInstalled(input.shell, existing)) {
    return { status: "already_installed", path };
  }
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const body = input.script.endsWith("\n") ? input.script : `${input.script}\n`;
  await appendFile(path, `${prefix}${body}`, "utf8");
  return { status: "installed", path };
}

export async function maybePromptInitCompletionInstall(input: {
  format: "human" | "json";
  interactive: boolean;
  homeRoot?: string;
  env?: NodeJS.ProcessEnv;
  confirm?: (message: string) => Promise<boolean>;
}): Promise<void> {
  if (input.format !== "human" || !input.interactive) return;

  const env = input.env ?? process.env;
  const shell = detectShellFromEnv(env);
  if (!shell) {
    ui.dim(
      "Skip tab completion setup (unknown $SHELL). Use: ht init completion <bash|zsh|fish>",
    );
    return;
  }

  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const target = resolveCompletionTargetPath(shell, homeRoot);
  const confirm =
    input.confirm
    ?? ((message: string) => promptForConfirmation({ message, default: true }));

  const ok = await confirm(
    `Enable tab completion for ${shell}? (writes ${target})`,
  );
  if (!ok) return;

  // `_program` is unused by renderShellCompletion; avoid importing cli/program (cycle).
  const script = renderShellCompletion(shell, {} as Command);
  const result = await installShellCompletion({ shell, homeRoot, script });
  if (result.status === "already_installed") {
    ui.dim(`Tab completion already present in ${result.path}`);
    return;
  }
  ui.success(`Tab completion installed → ${result.path}`);
}
