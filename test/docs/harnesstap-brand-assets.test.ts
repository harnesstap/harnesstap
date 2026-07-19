import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

describe("HarnessTap shared brand assets", () => {
  test("uses the shared Flow Split lockup in the README", async () => {
    const [readme, mark, lockup] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("docs/assets/harnesstap-mark.svg", "utf8"),
      readFile("docs/assets/harnesstap-lockup.svg", "utf8"),
    ]);

    expect(readme).toContain('src="docs/assets/harnesstap-lockup.svg"');
    expect(mark).toContain('d="M12.5 16H29"');
    expect(lockup).toContain('id="harnesstap-wordmark"');
    expect(lockup).not.toContain("<text");
  });
});
