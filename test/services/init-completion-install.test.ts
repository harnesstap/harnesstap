import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completionAlreadyInstalled,
  detectShellFromEnv,
  resolveCompletionTargetPath,
  installShellCompletion,
  maybePromptInitCompletionInstall,
  COMPLETION_MARKERS,
} from "../../src/services/init-completion-install.ts";

describe("init-completion-install", () => {
  it("detects bash/zsh/fish from SHELL basename and rejects unknown", () => {
    expect(detectShellFromEnv({ SHELL: "/bin/zsh" })).toBe("zsh");
    expect(detectShellFromEnv({ SHELL: "/usr/local/bin/bash" })).toBe("bash");
    expect(detectShellFromEnv({ SHELL: "/opt/homebrew/bin/fish" })).toBe("fish");
    expect(detectShellFromEnv({ SHELL: "/bin/nu" })).toBeUndefined();
    expect(detectShellFromEnv({})).toBeUndefined();
  });

  it("resolves default target paths under a home root", () => {
    expect(resolveCompletionTargetPath("zsh", "/tmp/home")).toBe("/tmp/home/.zshrc");
    expect(resolveCompletionTargetPath("bash", "/tmp/home")).toBe("/tmp/home/.bashrc");
    expect(resolveCompletionTargetPath("fish", "/tmp/home")).toBe(
      "/tmp/home/.config/fish/completions/ht.fish",
    );
  });

  it("detects markers and skips duplicate append for zsh", async () => {
    const home = await mkdtemp(join(tmpdir(), "ht-comp-"));
    const zshrc = join(home, ".zshrc");
    await writeFile(zshrc, `${COMPLETION_MARKERS.zsh}\n# already there\n`, "utf8");
    expect(completionAlreadyInstalled("zsh", await readFile(zshrc, "utf8"))).toBe(true);

    const result = await installShellCompletion({
      shell: "zsh",
      homeRoot: home,
      script: "#compdef ht harnesstap\n# fake\n",
    });
    expect(result.status).toBe("already_installed");
    expect(await readFile(zshrc, "utf8")).not.toContain("# fake");
  });

  it("appends bash/zsh and writes fish completion file", async () => {
    const home = await mkdtemp(join(tmpdir(), "ht-comp-"));
    const bash = await installShellCompletion({
      shell: "bash",
      homeRoot: home,
      script: "# harnesstap bash completion\ncomplete -F _x ht\n",
    });
    expect(bash.status).toBe("installed");
    expect(await readFile(join(home, ".bashrc"), "utf8")).toContain(
      "harnesstap bash completion",
    );

    await mkdir(join(home, ".config", "fish", "completions"), { recursive: true });
    const fish = await installShellCompletion({
      shell: "fish",
      homeRoot: home,
      script: "# harnesstap fish completion\n",
    });
    expect(fish.status).toBe("installed");
    expect(
      await readFile(join(home, ".config", "fish", "completions", "ht.fish"), "utf8"),
    ).toContain("harnesstap fish completion");
  });
});

describe("maybePromptInitCompletionInstall", () => {
  it("skips when format is json or interactive is false", async () => {
    let confirmCalls = 0;
    const confirm = async () => {
      confirmCalls += 1;
      return true;
    };

    await maybePromptInitCompletionInstall({
      format: "json",
      interactive: true,
      env: { SHELL: "/bin/zsh" },
      confirm,
    });
    await maybePromptInitCompletionInstall({
      format: "human",
      interactive: false,
      env: { SHELL: "/bin/zsh" },
      confirm,
    });
    expect(confirmCalls).toBe(0);
  });

  it("skips confirm when SHELL is unknown", async () => {
    let confirmCalls = 0;
    await maybePromptInitCompletionInstall({
      format: "human",
      interactive: true,
      env: { SHELL: "/bin/nu" },
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
    });
    expect(confirmCalls).toBe(0);
  });

  it("installs and writes marker when confirm returns true", async () => {
    const home = await mkdtemp(join(tmpdir(), "ht-comp-prompt-"));
    let confirmCalls = 0;

    await maybePromptInitCompletionInstall({
      format: "human",
      interactive: true,
      homeRoot: home,
      env: { SHELL: "/bin/zsh" },
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
    });

    expect(confirmCalls).toBe(1);
    const zshrc = await readFile(join(home, ".zshrc"), "utf8");
    expect(zshrc).toContain(COMPLETION_MARKERS.zsh);
    expect(zshrc).toContain("compdef _harnesstap");
  });

  it("does not write when confirm returns false", async () => {
    const home = await mkdtemp(join(tmpdir(), "ht-comp-prompt-"));
    await maybePromptInitCompletionInstall({
      format: "human",
      interactive: true,
      homeRoot: home,
      env: { SHELL: "/bin/bash" },
      confirm: async () => false,
    });
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
  });

  it("reports already_installed when marker is present", async () => {
    const home = await mkdtemp(join(tmpdir(), "ht-comp-prompt-"));
    const zshrc = join(home, ".zshrc");
    await writeFile(zshrc, `${COMPLETION_MARKERS.zsh}\n# existing\n`, "utf8");

    await maybePromptInitCompletionInstall({
      format: "human",
      interactive: true,
      homeRoot: home,
      env: { SHELL: "/bin/zsh" },
      confirm: async () => true,
    });

    const contents = await readFile(zshrc, "utf8");
    expect(contents).toBe(`${COMPLETION_MARKERS.zsh}\n# existing\n`);
    expect(contents).not.toContain("compdef _harnesstap");
  });
});
