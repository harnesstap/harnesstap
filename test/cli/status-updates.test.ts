import { describe, expect, it, spyOn } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { formatUpdatesLine } from "../../src/services/upstream-check-read.ts";

async function seedRows(rows: Array<[string, string, string, string]>): Promise<void> {
  const { getDb } = await import("../../src/db/connection.ts");
  const insert = getDb().prepare(
    `INSERT INTO upstream_checks (plugin_name, ref, local_version, latest_in_range, latest_major, status, checked_at)
     VALUES (?, ?, '1.0.0', ?, '', ?, datetime())`,
  );
  for (const [name, ref, latest, status] of rows) insert.run(name, ref, latest, status);
}

describe("ht status updates line", () => {
  it("formats counts and leaves majors out of the update count", () => {
    expect(formatUpdatesLine({ count: 0, major_count: 0 })).toBe("");
    expect(formatUpdatesLine({ count: 2, major_count: 0 })).toBe("2 updates available (ht plugin update --all)");
    expect(formatUpdatesLine({ count: 1, major_count: 1 })).toBe(
      "1 update available (ht plugin update --all); 1 major version available, not installed automatically",
    );
  });

  it("prints one Updates row read from the table, with no network call", async () => {
    const context = await createTestContext("cli-status-updates");
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/status-updates.git");
      await runCli(["init"]);
      await seedRows([
        ["backend-qa", "acme/default/backend@^1.0.0", "1.2.0", "update"],
        ["Backend engineer", "acme/default/backend@^1.0.0", "1.2.0", "update"],
        ["ops", "acme/default/ops@^1.0.0", "1.0.0", "current"],
      ]);
      fetchSpy.mockClear();

      const human = await runCli(["status", context.projectDir]);
      expect(human.stdout).toContain("2 updates available (ht plugin update --all)");

      const json = await runCli(["status", context.projectDir, "--format", "json"]);
      const payload = JSON.parse(json.stdout) as { updates: { count: number; major_count: number } };
      expect(payload.updates).toMatchObject({ count: 2, major_count: 0 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("prints no Updates row when nothing is pending", async () => {
    const context = await createTestContext("cli-status-no-updates");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/status-none.git");
      await runCli(["init"]);
      const human = await runCli(["status", context.projectDir]);
      expect(human.stdout).not.toContain("Updates");
    } finally {
      await context.cleanup();
    }
  });
});
