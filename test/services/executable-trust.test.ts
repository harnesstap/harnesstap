import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  exactGrantMatch,
  evaluateExecutableType,
  execStatusFromDecisions,
  executableGateOptedIn,
  loadProjectExecutables,
  parseProjectExecutables,
  writeProjectExecutableGrant,
  writeUserExecutableGrant,
  type ExecutableTrustContext,
  type ExecTypeDecision,
} from "../../src/services/executable-trust.ts";
import { parseApmPolicyDocument } from "../../src/services/apm-policy.ts";
import { createTempDir } from "../helpers/fs.ts";

function context(overrides: Partial<ExecutableTrustContext> = {}): ExecutableTrustContext {
  return {
    optedIn: true,
    warnings: [],
    binDeployDenyAll: false,
    binDeployDeny: [],
    project: { present: true, allow: {}, deny: {} },
    user: { allow: {}, deny: {} },
    ...overrides,
  };
}

function decision(
  contextValue: ExecutableTrustContext,
  identities: string[],
  type: "hooks" | "bin" | "mcp" = "hooks",
): ExecTypeDecision {
  return evaluateExecutableType(contextValue, identities, type);
}

describe("executable gate opt-in", () => {
  it("is off when the project omits executables and policy has no block", () => {
    expect(executableGateOptedIn({ present: false, allow: {}, deny: {} })).toBe(false);
  });

  it("is on when the project declares an empty executables block", () => {
    expect(parseProjectExecutables({}).present).toBe(true);
    expect(executableGateOptedIn({ present: true, allow: {}, deny: {} })).toBe(true);
  });

  it("is on when policy has a non-empty executables block", () => {
    const policy = parseApmPolicyDocument(
      "executables:\n  deny_all: false\n",
      "apm-policy.yml",
    );
    expect(policy.executables.nonEmpty).toBe(true);
    expect(executableGateOptedIn({ present: false, allow: {}, deny: {} }, policy)).toBe(true);
  });

  it("treats an empty policy executables mapping as not opting in", () => {
    const policy = parseApmPolicyDocument("executables: {}\n", "apm-policy.yml");
    expect(policy.executables.present).toBe(true);
    expect(policy.executables.nonEmpty).toBe(false);
    expect(executableGateOptedIn({ present: false, allow: {}, deny: {} }, policy)).toBe(false);
  });
});

describe("deny-wins ladder", () => {
  const pkg = ["acme/hooks", "acme/hooks#1.0.0"];

  it("defaults to gated pending approval", () => {
    const result = decision(context(), pkg);
    expect(result.outcome).toBe("gated_pending_approval");
    expect(result.layer).toBe("none");
  });

  it("org deny_all is the ceiling", () => {
    const result = decision(
      context({
        org: {
          present: true,
          nonEmpty: true,
          denyAll: true,
          deny: [],
          require: [],
          recommend: ["acme/hooks"],
          enforce: [],
          warnings: [],
        },
        project: { present: true, allow: { "acme/hooks": { hooks: true } }, deny: {} },
      }),
      pkg,
    );
    expect(result.outcome).toBe("denied");
    expect(result.layer).toBe("org-deny-all");
  });

  it("org deny globs match owner/repo and beat project allow", () => {
    const result = decision(
      context({
        org: {
          present: true,
          nonEmpty: true,
          denyAll: false,
          deny: ["evil/*"],
          require: [],
          recommend: [],
          enforce: [],
          warnings: [],
        },
        project: { present: true, allow: { "evil/pkg": { hooks: true } }, deny: {} },
      }),
      ["evil/pkg"],
    );
    expect(result.outcome).toBe("denied");
    expect(result.layer).toBe("org-deny");
  });

  it("user deny narrows past project allow", () => {
    const result = decision(
      context({
        project: { present: true, allow: { "acme/hooks": { hooks: true } }, deny: {} },
        user: { allow: {}, deny: { "acme/hooks": { hooks: true } } },
      }),
      pkg,
    );
    expect(result.outcome).toBe("denied");
    expect(result.layer).toBe("user-deny");
  });

  it("project deny beats project allow", () => {
    const result = decision(
      context({
        project: {
          present: true,
          allow: { "acme/hooks": { hooks: true } },
          deny: { "acme/hooks": { hooks: true } },
        },
      }),
      pkg,
    );
    expect(result.outcome).toBe("denied");
    expect(result.layer).toBe("project-deny");
  });

  it("project allow wins over user allow and recommend", () => {
    const result = decision(
      context({
        org: {
          present: true,
          nonEmpty: true,
          denyAll: false,
          deny: [],
          require: [],
          recommend: ["acme/hooks"],
          enforce: [],
          warnings: [],
        },
        project: { present: true, allow: { "acme/hooks": { hooks: true } }, deny: {} },
        user: { allow: { "acme/hooks": { hooks: true } }, deny: {} },
      }),
      pkg,
    );
    expect(result.outcome).toBe("allowed");
    expect(result.layer).toBe("project-allow");
    expect(result.shadowed.map((entry) => entry.layer)).toEqual(["user-allow", "org-recommend"]);
  });

  it("org recommend allows unless locally denied", () => {
    const allowed = decision(
      context({
        org: {
          present: true,
          nonEmpty: true,
          denyAll: false,
          deny: [],
          require: [],
          recommend: ["acme/hooks"],
          enforce: [],
          warnings: [],
        },
      }),
      pkg,
    );
    expect(allowed.outcome).toBe("allowed");
    expect(allowed.layer).toBe("org-recommend");
  });

  it("matches version-blind grant keys", () => {
    expect(exactGrantMatch("acme/hooks#9.0.0", ["github.com/acme/hooks", "acme/hooks"])).toBe(true);
    expect(exactGrantMatch("acme/other", ["acme/hooks"])).toBe(false);
  });

  it("folds bin_deploy into bin deny only", () => {
    const hooks = decision(
      context({ binDeployDenyAll: true }),
      pkg,
      "hooks",
    );
    const bin = decision(context({ binDeployDenyAll: true }), pkg, "bin");
    expect(hooks.outcome).toBe("gated_pending_approval");
    expect(bin.outcome).toBe("denied");
    expect(bin.layer).toBe("org-deny");
  });

  it("degrades executables.enforce to recommend and warns", () => {
    const policy = parseApmPolicyDocument(
      "executables:\n  enforce:\n    - acme/hooks\n",
      "apm-policy.yml",
    );
    expect(policy.executables.recommend).toContain("acme/hooks");
    expect(policy.executables.warnings.some((warning) => warning.includes("inert"))).toBe(true);
    const result = decision(context({ org: policy.executables }), pkg);
    expect(result.outcome).toBe("allowed");
    expect(result.layer).toBe("org-recommend");
  });
});

describe("exec_status rollup", () => {
  it("is absent with no gated types", () => {
    expect(execStatusFromDecisions([], [])).toBe("absent");
  });

  it("prefers denied over pending", () => {
    expect(
      execStatusFromDecisions(
        ["hooks", "mcp"],
        [
          { type: "hooks", outcome: "denied", layer: "org-deny", shadowed: [] },
          { type: "mcp", outcome: "gated_pending_approval", layer: "none", shadowed: [] },
        ],
      ),
    ).toBe("denied");
  });

  it("is deployed when every gated type is allowed", () => {
    expect(
      execStatusFromDecisions(
        ["hooks"],
        [{ type: "hooks", outcome: "allowed", layer: "project-allow", shadowed: [] }],
      ),
    ).toBe("deployed");
  });
});

describe("grant writes", () => {
  it("writes project apm.yml executables.allow", () => {
    const root = createTempDir("exec-grant-");
    writeFileSync(join(root, "apm.yml"), "name: demo\nversion: \"1.0.0\"\n", "utf8");
    writeProjectExecutableGrant({ projectRoot: root, side: "allow", refs: ["acme/hooks"] });
    const loaded = loadProjectExecutables(root);
    expect(loaded.present).toBe(true);
    expect(loaded.allow["acme/hooks"]?.hooks).toBe(true);
  });

  it("writes user config.jsonc executables.deny", () => {
    const dir = createTempDir("exec-user-");
    mkdirSync(dir, { recursive: true });
    writeUserExecutableGrant({
      side: "deny",
      refs: ["evil/pkg"],
      harnesstapDir: dir,
    });
    const raw = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf8")) as {
      executables?: { deny?: Record<string, { hooks?: boolean }> };
    };
    expect(raw.executables?.deny?.["evil/pkg"]?.hooks).toBe(true);
  });
});
