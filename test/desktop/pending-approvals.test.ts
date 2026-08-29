import { describe, expect, it } from "bun:test";
import {
  pendingApprovalCliHint,
  pendingApprovalsFromTrust,
  shouldShowPendingApprovalsStrip,
  trustFieldsFromUnknown,
} from "../../apps/desktop/src/lib/pending-approvals.ts";

describe("pending approvals from apply/switch trust fields", () => {
  it("hides the strip when the gate is off", () => {
    const fields = trustFieldsFromUnknown({
      optedIn: false,
      parked: [{ ref: "acme/hooks", types: ["hooks"] }],
      execStatuses: { dep: "gated_pending_approval" },
      warnings: [],
    });
    expect(shouldShowPendingApprovalsStrip(fields)).toBe(false);
    expect(pendingApprovalsFromTrust(fields)).toEqual([]);
  });

  it("lists parked refs when apply/switch parks executables", () => {
    const fields = trustFieldsFromUnknown({
      optedIn: true,
      parked: [{ ref: "acme/hooks", types: ["hooks", "bin"] }],
      execStatuses: { "dep-hooks": "gated_pending_approval" },
      warnings: [],
    });
    expect(shouldShowPendingApprovalsStrip(fields)).toBe(true);
    expect(pendingApprovalsFromTrust(fields)).toEqual([
      { ref: "acme/hooks", types: ["hooks", "bin"] },
    ]);
  });

  it("returns approve/deny CLI hints for pending refs", () => {
    expect(pendingApprovalCliHint(["acme/hooks"])).toEqual({
      approve: "ht approve acme/hooks",
      deny: "ht deny acme/hooks",
    });
  });
});
