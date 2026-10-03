import { describe, expect, it } from "bun:test";
import { scopeHostConfigToResource } from "../../src/services/host-config-resource-detail.ts";

const settings = JSON.stringify(
  {
    permissions: {
      allow: ["Bash(jk:*)", "Read(*)"],
      deny: ["Write(*)"],
    },
    env: { FOO: "1", BAR: "2" },
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: "ponytail" }],
        },
      ],
    },
  },
  null,
  2,
);

describe("scopeHostConfigToResource", () => {
  it("keeps only the selected permission rule", () => {
    const scoped = scopeHostConfigToResource(settings, {
      type: "permission",
      name: "allow-Bash(jk:*)",
    });
    expect(scoped).toContain("Bash(jk:*)");
    expect(scoped).not.toContain("Read(*)");
    expect(scoped).not.toContain("Write(*)");
    expect(scoped).not.toContain("ponytail");
    expect(scoped).not.toContain("SessionStart");
    expect(scoped).not.toContain("FOO");
  });

  it("returns an empty permissions object when that rule is absent", () => {
    const scoped = scopeHostConfigToResource(settings, {
      type: "permission",
      name: "allow-Edit(*)",
    });
    expect(scoped).toBe(`${JSON.stringify({ permissions: {} }, null, 2)}\n`);
  });

  it("keeps only the selected hook", () => {
    const scoped = scopeHostConfigToResource(settings, {
      type: "hook",
      name: "SessionStart-1",
    });
    expect(scoped).toContain("SessionStart");
    expect(scoped).toContain("ponytail");
    expect(scoped).not.toContain("Bash(jk:*)");
    expect(scoped).not.toContain("Read(*)");
    expect(scoped).not.toContain("FOO");
  });

  it("returns an empty hooks object when that hook is absent", () => {
    const scoped = scopeHostConfigToResource(settings, {
      type: "hook",
      name: "Stop-1",
    });
    expect(scoped).toBe(`${JSON.stringify({ hooks: {} }, null, 2)}\n`);
  });

  it("keeps only the selected env var", () => {
    const scoped = scopeHostConfigToResource(settings, {
      type: "env_var",
      name: "FOO",
    });
    expect(scoped).toContain("FOO");
    expect(scoped).not.toContain("BAR");
    expect(scoped).not.toContain("ponytail");
  });
});
