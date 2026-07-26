import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("database connection", () => {
  it("enables WAL, busy_timeout, and foreign_keys on open", async () => {
    const context = await createInitializedTestContext("db-connection");
    try {
      const db = context.connection.getDb();
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
      expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({
        timeout: 5000,
      });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
        foreign_keys: 1,
      });
    } finally {
      await context.cleanup();
    }
  });
});
