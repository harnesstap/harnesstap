import { describe, expect, it } from "bun:test";
import { shortenHomePath } from "../../src/utils/home-path.ts";

describe("shortenHomePath", () => {
  const home = "/tmp/ht-home";

  it("replaces a home prefix with a tilde", () => {
    expect(shortenHomePath(`${home}/.claude.json`, home)).toBe("~/.claude.json");
    expect(shortenHomePath(home, home)).toBe("~");
  });

  it("leaves paths outside home unchanged", () => {
    expect(shortenHomePath("/Users/me/.claude/skills/archify", home)).toBe(
      "/Users/me/.claude/skills/archify",
    );
    expect(shortenHomePath(`${home}-other/file`, home)).toBe(`${home}-other/file`);
  });

  it("keeps a path that is already shortened", () => {
    expect(shortenHomePath("~/.codex/config.toml", home)).toBe("~/.codex/config.toml");
  });
});
