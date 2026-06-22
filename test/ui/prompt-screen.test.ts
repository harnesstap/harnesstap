import { describe, expect, it } from "bun:test";
import { createPromptScreen } from "../../src/ui/prompt-screen.ts";

describe("prompt screen", () => {
  it("enter/exit are no-op when not TTY", () => {
    const writes: string[] = [];
    const output = {
      isTTY: false,
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as NodeJS.WritableStream;

    const screen = createPromptScreen({ isTty: false, output });
    screen.enter();
    screen.exit();

    expect(writes).toEqual([]);
  });

  it("enter writes alternate screen sequence when TTY", () => {
    const writes: string[] = [];
    const output = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as NodeJS.WritableStream;

    const screen = createPromptScreen({ isTty: true, output });
    screen.enter();

    expect(writes).toEqual(["\x1b[?1049h"]);
  });

  it("exit writes alternate screen restore sequence when TTY", () => {
    const writes: string[] = [];
    const output = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as NodeJS.WritableStream;

    const screen = createPromptScreen({ isTty: true, output });
    screen.exit();

    expect(writes).toEqual(["\x1b[?1049l"]);
  });

  it("render writes content to output", () => {
    const writes: string[] = [];
    const output = {
      isTTY: false,
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as NodeJS.WritableStream;

    const screen = createPromptScreen({ output });
    screen.render("hello");

    expect(writes).toEqual(["hello"]);
  });
});
