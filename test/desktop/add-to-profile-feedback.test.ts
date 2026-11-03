import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { commandInstructionIn } from "../../apps/desktop/src/lib/command-instructions.ts";
import { addedAndAppliedTitle, addedToProfileToast } from "../../apps/desktop/src/lib/ui-copy.ts";

const desktopSrc = join(import.meta.dir, "../../apps/desktop/src");
const read = (path: string) => readFileSync(join(desktopSrc, path), "utf-8");

function between(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = src.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe("Add to profile feedback", () => {
  it("names the item and the profile, and points at a UI action", () => {
    const copy = addedToProfileToast("ship", "work");
    expect(copy).toEqual({
      tone: "success",
      title: "Added ship to work",
      detail: "Apply the profile to write it to your harnesses.",
    });
    expect(commandInstructionIn(`${copy.title} ${copy.detail}`)).toBeNull();
    expect(`${copy.title}${copy.detail}`).not.toMatch(/[\u2013\u2014\u2026]/);
  });

  it("confirms create plus add in one message", () => {
    const copy = addedToProfileToast("ship", "work", { created: true });
    expect(copy.title).toBe("Created ship and added it to work");
    expect(copy.detail).toBe("Apply the profile to write it to your harnesses.");
    expect(addedAndAppliedTitle("ship", "work", { created: true })).toBe(
      "Created ship, added it to work, and applied",
    );
    expect(addedAndAppliedTitle("ship", "work")).toBe("Added ship and applied");
    for (const text of [copy.title, addedAndAppliedTitle("ship", "work", { created: true })]) {
      expect(commandInstructionIn(text)).toBeNull();
      expect(text).not.toMatch(/[\u2013\u2014\u2026]/);
    }
  });

  it("create panel leaves the confirmation to the add instead of a second toast", () => {
    const panel = read("components/ResourceCreatePanel.tsx");
    expect(panel).toContain("await onAddToProfile({ type, name }, { created: true });");
    expect(panel).toContain("if (!addedToProfile) {");
    const src = read("state/scope-controller.ts");
    const addResource = between(src, "const handleAddResource = useCallback(", "\n  );\n");
    expect(addResource).toContain("addedAndAppliedTitle(resource.name, profileName");
    expect(addResource).toContain("created: options?.created");
  });

  it("toasts success when an add does not auto-apply", () => {
    const src = read("state/scope-controller.ts");
    const addResource = between(src, "const handleAddResource = useCallback(", "\n  );\n");
    expect(addResource).toContain("addedToProfileToast(resource.name, profileName, { created: options?.created })");
    const reapply = between(src, "const maybeAutoReapplyAfterMutation = useCallback(", "\n  );\n");
    expect(reapply).toContain("toast(addedToProfileToast(mutation.addedName, mutation.profileName))");
  });

  it("shows add errors once, at the action that started them", () => {
    const src = read("state/scope-controller.ts");
    const addResource = between(src, "const handleAddResource = useCallback(", "\n  );\n");
    const attach = between(src, "const handleAttachLibraryItem = useCallback(", "\n  );\n");
    expect(addResource).not.toContain("setAddResourceError(messageOf");
    expect(attach).not.toContain("setAddResourceError(messageOf");
    const shell = read("components/live/ScopeInventoryShell.tsx");
    const runAdd = between(shell, "const runAdd = async", "const runActivate");
    expect(runAdd).toContain("detail: desktopAgentText(");
    expect(runAdd).toContain('label: "Retry"');
  });
});
