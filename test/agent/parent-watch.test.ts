import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  installAgentParentWatch,
  parentProcessAlive,
} from "../../src/agent/parent-watch.ts";

describe("parentProcessAlive", () => {
  it("treats pid 1 as still alive so the agent does not exit under init", () => {
    expect(parentProcessAlive(1, () => {
      throw new Error("should not probe init");
    })).toBe(true);
  });

  it("is alive when kill(pid, 0) succeeds and dead when it throws", () => {
    expect(parentProcessAlive(42, () => true)).toBe(true);
    expect(
      parentProcessAlive(42, () => {
        throw new Error("ESRCH");
      }),
    ).toBe(false);
  });
});

describe("installAgentParentWatch", () => {
  it("calls onOrphan once when the parent pid is gone", async () => {
    let calls = 0;
    const stop = installAgentParentWatch({
      parentPid: 99,
      intervalMs: 10,
      isAlive: () => false,
      onOrphan: () => {
        calls += 1;
      },
    });
    await Bun.sleep(30);
    expect(calls).toBe(1);
    stop();
  });

  it("calls onOrphan when stdin ends", () => {
    let calls = 0;
    const stdin = new EventEmitter();
    const stop = installAgentParentWatch({
      parentPid: 99,
      intervalMs: 60_000,
      isAlive: () => true,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      onOrphan: () => {
        calls += 1;
      },
    });
    stdin.emit("end");
    stdin.emit("close");
    expect(calls).toBe(1);
    stop();
  });
});
