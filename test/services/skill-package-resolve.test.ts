import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  defaultInteractiveSkillNames,
  resolveSelectedSkills,
  resolveSkillPackageCheckout,
} from "../../src/services/skill-package-resolve.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-package-resolve", () => {
  it("defaults interactive selection to all skills except excluded categories", () => {
    const resolved = resolveSkillPackageCheckout(fixture, "/tmp/harnesstap");
    const defaults = defaultInteractiveSkillNames(resolved.discovered, ["engineering"]);
    expect(defaults).toEqual(["caveman"]);
  });

  it("applies exclude-category when --all is used", () => {
    const resolved = resolveSkillPackageCheckout(fixture, "/tmp/harnesstap");
    const selected = resolveSelectedSkills(resolved.discovered, {
      all: true,
      excludeCategories: ["engineering"],
    });
    expect(selected.map((skill) => skill.name)).toEqual(["caveman"]);
  });

  it("resolves explicit skill names", () => {
    const resolved = resolveSkillPackageCheckout(fixture, "/tmp/harnesstap");
    const selected = resolveSelectedSkills(resolved.discovered, {
      skillNames: ["caveman", "tdd"],
    });
    expect(selected.map((skill) => skill.name).sort()).toEqual(["caveman", "tdd"]);
  });
});
