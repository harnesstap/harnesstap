import { describe, expect, it } from "bun:test";
import { buildEnvSuggestionChoices } from "../../src/services/wizards/environment-create.ts";

describe("environment create wizard helpers", () => {
  it("buildEnvSuggestionChoices marks exact matches as default selected", () => {
    const choices = buildEnvSuggestionChoices(
      ["REQ_EXACT", "API_TOKEN"],
      {
        REQ_EXACT: "exact-value",
        MY_API_TOKEN: "token-value",
        PATH: "/usr/bin",
      },
    );

    expect(choices).toEqual([
      {
        name: "REQ_EXACT (exact match)",
        value: "REQ_EXACT",
        description: "process.env.REQ_EXACT",
        defaultSelected: true,
      },
      {
        name: "MY_API_TOKEN (fuzzy match)",
        value: "MY_API_TOKEN",
        description: "process.env.MY_API_TOKEN",
        defaultSelected: false,
      },
    ]);
  });
});
