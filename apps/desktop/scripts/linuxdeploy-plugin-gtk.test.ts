import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WRAPPER = join(import.meta.dir, "linuxdeploy-plugin-gtk.sh");

describe("linuxdeploy-plugin-gtk wrapper", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports plugin API version 0", () => {
    const result = Bun.spawnSync(["bash", WRAPPER, "--plugin-api-version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("0");
  });

  it("shelters ldd-incompatible usr/bin files during the gtk pass and restores them", () => {
    if (process.platform !== "linux") {
      return;
    }

    const trueBin = ["/usr/bin/true", "/bin/true"].find((path) => existsSync(path));
    if (!trueBin) {
      throw new Error("expected /usr/bin/true or /bin/true");
    }

    const root = mkdtempSync(join(tmpdir(), "ld-gtk-"));
    dirs.push(root);
    const appdir = join(root, "HarnessTap.AppDir");
    mkdirSync(join(appdir, "usr", "bin"), { recursive: true });
    copyFileSync(trueBin, join(appdir, "usr", "bin", "harnesstap-desktop"));
    chmodSync(join(appdir, "usr", "bin", "harnesstap-desktop"), 0o755);
    writeFileSync(join(appdir, "usr", "bin", "ht-agent"), "#!/bin/sh\necho sidecar\n");
    chmodSync(join(appdir, "usr", "bin", "ht-agent"), 0o755);

    const seenPath = join(root, "seen.txt");
    const upstream = join(root, "linuxdeploy-plugin-gtk.upstream.sh");
    writeFileSync(
      upstream,
      `#!/usr/bin/env bash
set -euo pipefail
APPDIR=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--appdir" ]; then
    APPDIR="$arg"
  fi
  prev="$arg"
done
ls -1 "$APPDIR/usr/bin" > "${seenPath}"
`,
    );
    chmodSync(upstream, 0o755);

    const result = Bun.spawnSync({
      cmd: ["bash", WRAPPER, "--appdir", appdir],
      env: {
        ...process.env,
        LINUXDEPLOY_PLUGIN_GTK_UPSTREAM: upstream,
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Sheltering ldd-incompatible binary");

    const seen = readFileSync(seenPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(seen).toContain("harnesstap-desktop");
    expect(seen).not.toContain("ht-agent");
    expect(existsSync(join(appdir, "usr", "bin", "ht-agent"))).toBe(true);
    expect(existsSync(join(appdir, "usr", "bin", "harnesstap-desktop"))).toBe(true);
  });

  it("restores sheltered binaries when the upstream plugin fails", () => {
    if (process.platform !== "linux") {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "ld-gtk-fail-"));
    dirs.push(root);
    const appdir = join(root, "HarnessTap.AppDir");
    mkdirSync(join(appdir, "usr", "bin"), { recursive: true });
    writeFileSync(join(appdir, "usr", "bin", "ht-agent"), "#!/bin/sh\necho sidecar\n");
    chmodSync(join(appdir, "usr", "bin", "ht-agent"), 0o755);

    const upstream = join(root, "linuxdeploy-plugin-gtk.upstream.sh");
    writeFileSync(upstream, "#!/usr/bin/env bash\nexit 42\n");
    chmodSync(upstream, 0o755);

    const result = Bun.spawnSync({
      cmd: ["bash", WRAPPER, "--appdir", appdir],
      env: {
        ...process.env,
        LINUXDEPLOY_PLUGIN_GTK_UPSTREAM: upstream,
      },
    });
    expect(result.exitCode).toBe(42);
    expect(existsSync(join(appdir, "usr", "bin", "ht-agent"))).toBe(true);
  });
});
