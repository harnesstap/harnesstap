import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  APM_POLICY_FILENAME,
  buildAuditInstallPlan,
  evaluatePolicy,
  hashPolicyBytes,
  loadAndEvaluateProjectPolicy,
  loadProjectPolicy,
  matchPolicyPattern,
  parseApmPolicyDocument,
  parseApmPolicyPin,
  sourceFromApmDependency,
  type PolicyInstallPlan,
} from "../../src/services/apm-policy.ts";
import { parseApmDependencyString } from "../../src/services/apm-dependencies.ts";
import { createTempDir } from "../helpers/fs.ts";

function emptyPlan(overrides: Partial<PolicyInstallPlan> = {}): PolicyInstallPlan {
  return { sources: [], primitives: [], mcp: [], ...overrides };
}

function writePolicy(root: string, body: string): string {
  const path = join(root, APM_POLICY_FILENAME);
  writeFileSync(path, body, "utf8");
  return path;
}

describe("parseApmPolicyDocument", () => {
  it("defaults enforcement to warn and trust_transitive to false", () => {
    const policy = parseApmPolicyDocument("name: baseline\n", "apm-policy.yml");
    expect(policy.enforcement).toBe("warn");
    expect(policy.trustTransitive).toBe(false);
    expect(policy.dependenciesAllow).toBeNull();
  });

  it("parses OpenAPM allow lists and content types", () => {
    const policy = parseApmPolicyDocument(
      `
name: org
enforcement: block
dependencies:
  allow:
    - github.com/*
    - catalog
    - ./
  deny:
    - evil.com/*
mcp:
  trust_transitive: false
  allow:
    - github/github-mcp-server
manifest:
  content_types:
    allow:
      - skill
      - agent
      - command
      - hook
      - instruction
      - mcp
`,
      "apm-policy.yml",
    );
    expect(policy.enforcement).toBe("block");
    expect(policy.dependenciesAllow).toEqual(["github.com/*", "catalog", "./"]);
    expect(policy.contentTypesAllow).toContain("skill");
  });

  it("warns on unknown top-level keys and keeps x- extensions silent", () => {
    const policy = parseApmPolicyDocument(
      `
name: x
future_field: 1
x-harnesstap:
  note: ok
`,
      "apm-policy.yml",
    );
    expect(policy.warnings.some((warning) => warning.includes("future_field"))).toBe(true);
    expect(policy.warnings.some((warning) => warning.includes("x-harnesstap"))).toBe(false);
  });
});

describe("policy.hash pin", () => {
  it("rejects md5 and infers sha256 from the digest prefix", () => {
    expect(() => parseApmPolicyPin({ hash: "deadbeef", hash_algorithm: "md5" })).toThrow(/sha256/);
    const pin = parseApmPolicyPin({ hash: "sha256:abcd" });
    expect(pin?.algorithm).toBe("sha256");
  });

  it("fails closed when the pin is set and the file is missing", () => {
    const root = createTempDir("policy-missing-");
    const loaded = loadProjectPolicy({
      projectRoot: root,
      pin: { hash: "sha256:00", algorithm: "sha256" },
    });
    expect(loaded.status).toBe("failed");
    expect(loaded.violations[0]?.code).toBe("policy-missing");
  });

  it("fails closed on hash mismatch and passes when bytes match", () => {
    const root = createTempDir("policy-hash-");
    const body = "name: pinned\nenforcement: block\n";
    writePolicy(root, body);
    const digest = hashPolicyBytes(Buffer.from(body, "utf8"), "sha256");
    const mismatch = loadProjectPolicy({
      projectRoot: root,
      pin: { hash: "sha256:00", algorithm: "sha256" },
    });
    expect(mismatch.status).toBe("failed");
    expect(mismatch.violations[0]?.code).toBe("policy-hash-mismatch");

    const ok = loadProjectPolicy({
      projectRoot: root,
      pin: { hash: digest, algorithm: "sha256" },
    });
    expect(ok.status).toBe("evaluated");
  });
});

describe("evaluatePolicy gates", () => {
  const blocking = parseApmPolicyDocument(
    `
enforcement: block
dependencies:
  allow:
    - github.com/*
    - catalog
    - local
  deny:
    - evil.com/*
manifest:
  content_types:
    allow:
      - skill
      - instruction
mcp:
  allow:
    - allowed-mcp
`,
    "apm-policy.yml",
  );

  it("allows git hosts, catalog, and local path; deny wins", () => {
    const git = sourceFromApmDependency(
      parseApmDependencyString("https://github.com/acme/widgets.git"),
    );
    const catalog = sourceFromApmDependency(parseApmDependencyString("acme/default/baseline"));
    const local = sourceFromApmDependency(parseApmDependencyString("./packages/local"));
    const evil = sourceFromApmDependency(
      parseApmDependencyString("https://evil.com/acme/widgets.git"),
    );
    expect(evaluatePolicy(blocking, emptyPlan({ sources: [git, catalog, local] }))).toEqual([]);
    expect(evaluatePolicy(blocking, emptyPlan({ sources: [evil] }))[0]?.code).toBe("source-denied");
  });

  it("rejects a git host that is not allow-listed", () => {
    const gitlab = sourceFromApmDependency(
      parseApmDependencyString("https://gitlab.com/acme/widgets.git"),
    );
    expect(evaluatePolicy(blocking, emptyPlan({ sources: [gitlab] }))[0]?.code).toBe(
      "source-not-allowed",
    );
  });

  it("rejects primitives outside manifest.content_types.allow", () => {
    const violations = evaluatePolicy(blocking, emptyPlan({ primitives: ["hook"] }));
    expect(violations[0]?.code).toBe("primitive-not-allowed");
  });

  it("fails closed on undeclared transitive MCP", () => {
    const violations = evaluatePolicy(
      blocking,
      emptyPlan({
        mcp: [
          { name: "sneaky", identity: "sneaky", depth: 1, declaredInManifest: false },
        ],
      }),
    );
    expect(violations[0]?.code).toBe("mcp-transitive");
  });

  it("allows transitive MCP when declared or allow-listed", () => {
    expect(
      evaluatePolicy(
        blocking,
        emptyPlan({
          mcp: [
            { name: "allowed-mcp", identity: "allowed-mcp", depth: 2, declaredInManifest: false },
            { name: "root-mcp", identity: "root-mcp", depth: 1, declaredInManifest: true },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("matches host globs including nested owner/repo", () => {
    expect(matchPolicyPattern("github.com/*", ["github.com/acme/widgets", "github.com"])).toBe(
      true,
    );
  });
});

describe("loadAndEvaluateProjectPolicy", () => {
  it("skips when no policy file exists", () => {
    const root = createTempDir("policy-skip-");
    const result = loadAndEvaluateProjectPolicy({
      projectRoot: root,
      plan: emptyPlan(),
    });
    expect(result.status).toBe("skipped");
    expect(result.blocks).toBe(false);
  });

  it("fails --require-policy in CI when no file exists", () => {
    const root = createTempDir("policy-require-");
    const result = loadAndEvaluateProjectPolicy({
      projectRoot: root,
      plan: emptyPlan(),
      requirePolicy: true,
    });
    expect(result.status).toBe("failed");
    expect(result.blocks).toBe(true);
    expect(result.violations[0]?.code).toBe("policy-required");
  });

  it("blocks apply-style evaluation when enforcement is block", () => {
    const root = createTempDir("policy-eval-");
    writePolicy(
      root,
      `
enforcement: block
dependencies:
  allow:
    - github.com/*
`,
    );
    const gitlab = sourceFromApmDependency(
      parseApmDependencyString("https://gitlab.com/acme/widgets.git"),
    );
    const result = loadAndEvaluateProjectPolicy({
      projectRoot: root,
      plan: emptyPlan({ sources: [gitlab] }),
    });
    expect(result.blocks).toBe(true);
    expect(result.violations[0]?.code).toBe("source-not-allowed");
  });
});

describe("buildAuditInstallPlan", () => {
  it("collects local overlay primitives and manifest MCP as declared", () => {
    const root = createTempDir("policy-plan-");
    mkdirSync(join(root, ".apm", "skills", "ship"), { recursive: true });
    writeFileSync(join(root, ".apm", "skills", "ship", "SKILL.md"), "# ship\n");
    const plan = buildAuditInstallPlan({
      projectRoot: root,
      mcpDependencies: [
        { raw: "github/github-mcp-server", name: "github", selfDefined: false },
      ],
    });
    expect(plan.primitives).toContain("skill");
    expect(plan.primitives).toContain("mcp");
    expect(plan.mcp[0]?.declaredInManifest).toBe(true);
  });
});

describe("hashPolicyBytes", () => {
  it("matches Node sha256 hex with prefix", () => {
    const bytes = Buffer.from("name: x\n", "utf8");
    const expected = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    expect(hashPolicyBytes(bytes, "sha256")).toBe(expected);
  });
});
