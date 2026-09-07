import { describe, expect, it } from "bun:test";
import {
  GitPluginImportError,
  isGitHubPluginRef,
  normalizeGitHubPluginUrl,
} from "../../src/services/github-plugin-ref.ts";

describe("normalizeGitHubPluginUrl", () => {
  it("normalizes https, owner/repo, and gh: shorthand to git HTTPS", () => {
    expect(normalizeGitHubPluginUrl("https://github.com/DietrichGebert/ponytail")).toBe(
      "https://github.com/DietrichGebert/ponytail.git",
    );
    expect(normalizeGitHubPluginUrl("https://github.com/DietrichGebert/ponytail.git")).toBe(
      "https://github.com/DietrichGebert/ponytail.git",
    );
    expect(normalizeGitHubPluginUrl("DietrichGebert/ponytail")).toBe(
      "https://github.com/DietrichGebert/ponytail.git",
    );
    expect(normalizeGitHubPluginUrl("gh:DietrichGebert/ponytail")).toBe(
      "https://github.com/DietrichGebert/ponytail.git",
    );
    expect(normalizeGitHubPluginUrl("GH:DietrichGebert/ponytail")).toBe(
      "https://github.com/DietrichGebert/ponytail.git",
    );
  });

  it("rejects non-GitHub sources", () => {
    expect(() => normalizeGitHubPluginUrl("alpha@local-market")).toThrow(GitPluginImportError);
    expect(() => normalizeGitHubPluginUrl("acme/default/foundation")).toThrow(GitPluginImportError);
    expect(() => normalizeGitHubPluginUrl("https://gitlab.com/acme/plugin")).toThrow(
      GitPluginImportError,
    );
    expect(isGitHubPluginRef("DietrichGebert/ponytail")).toBe(true);
    expect(isGitHubPluginRef("alpha@local-market")).toBe(false);
  });
});
