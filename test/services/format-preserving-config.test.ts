import { describe, expect, it } from "bun:test";
import {
  applyJsonObjectUpdatePreservingFormat,
  applyTomlObjectUpdatePreservingFormat,
  overlayJsonPreservingFormat,
  overlayTomlPreservingFormat,
} from "../../src/services/format-preserving-config.ts";

describe("format-preserving JSON overlay", () => {
  it("returns the same bytes when overlay keys already match", () => {
    const existing = '{\n    "model": "sonnet",\n    "permissions": { "allow": ["Read"] }\n}\n';
    const next = overlayJsonPreservingFormat(existing, {
      model: "sonnet",
      permissions: { allow: ["Read"] },
    }, { mergeObjectKeys: ["permissions"] });
    expect(next).toBe(existing);
  });

  it("keeps indentation, key order, comments, and trailing newline when adding a key", () => {
    const existing = `{
    // user comment
    "zebra": 1,
    "alpha": true
}
`;
    const next = overlayJsonPreservingFormat(existing, { model: "opus" });
    expect(next).toContain("    // user comment");
    expect(next.indexOf('"zebra"')).toBeLessThan(next.indexOf('"alpha"'));
    expect(next).toContain('\n    "model": "opus"');
    expect(next.endsWith("\n")).toBe(true);
  });

  it("strips a missing JSON key without rewriting the rest", () => {
    const existing = '{\n  "keep": true,\n  "drop": false\n}\n';
    const next = applyJsonObjectUpdatePreservingFormat(existing, { keep: true });
    expect(next).toContain('"keep"');
    expect(next).not.toContain("drop");
    expect(next).toContain("  ");
    expect(next.endsWith("\n")).toBe(true);
  });
});

describe("format-preserving TOML overlay", () => {
  it("keeps Codex inline env tables when overlaying unrelated keys", () => {
    const existing = 'model = "gpt-5"\nenv = { FOO = "bar" }\nlegacy_flag = true\n';
    const next = overlayTomlPreservingFormat(
      existing,
      { model_provider: "openai" },
      (current, overlay) => ({ ...current, ...overlay }),
    );
    expect(next).toContain('env = { FOO = "bar" }');
    expect(next).not.toMatch(/\[env\]/);
    expect(next).toContain('model = "gpt-5"');
    expect(next).toContain('legacy_flag = true');
    expect(next).toContain('model_provider = "openai"');
    expect(next.endsWith("\n")).toBe(true);
  });

  it("returns the same bytes when the TOML document is already equal", () => {
    const existing = 'model = "gpt-5"\nenv = { FOO = "bar" }\n';
    const next = overlayTomlPreservingFormat(
      existing,
      { model: "gpt-5" },
      (current, overlay) => ({ ...current, ...overlay }),
    );
    expect(next).toBe(existing);
  });

  it("removes a TOML table without exploding sibling inline tables", () => {
    const existing = `model = "gpt-5"
env = { FOO = "bar" }

[mcp_servers.codex-mcp]
command = "uvx"
`;
    const next = applyTomlObjectUpdatePreservingFormat(existing, {
      model: "gpt-5",
      env: { FOO: "bar" },
    });
    expect(next).toContain('env = { FOO = "bar" }');
    expect(next).not.toContain("codex-mcp");
    expect(next).toContain('model = "gpt-5"');
  });
});
