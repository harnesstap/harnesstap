import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WRAP = join(import.meta.dir, "linuxdeploy-wrap.sh");

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body);
  await chmod(path, 0o755);
}

describe("linuxdeploy-wrap.sh", () => {
  test("shelters ht-agent by sidecar name even when system ldd exits 0, then restores before --output appimage", async () => {
    const root = await tempDir("linuxdeploy-wrap-");
    const appDir = join(root, "HarnessTap.AppDir");
    const usrBin = join(appDir, "usr", "bin");
    await mkdir(usrBin, { recursive: true });
    const sidecar = join(usrBin, "ht-agent");
    const desktop = join(usrBin, "harnesstap-desktop");
    await writeFile(sidecar, "sidecar-bytes");
    await writeFile(desktop, "desktop-bytes");
    await chmod(sidecar, 0o755);
    await chmod(desktop, 0o755);

    const extracted = join(root, "extracted");
    const pluginExtracted = join(root, "plugin-extracted");
    await mkdir(extracted);
    await mkdir(pluginExtracted);

    const log = join(root, "linuxdeploy.log");
    const pluginLog = join(root, "plugin.log");
    await writeExecutable(
      join(extracted, "AppRun"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> ${JSON.stringify(log)}
if printf '%s\\n' "$@" | grep -qx -- '--output'; then
  echo "linuxdeploy should not receive --output; wrap.sh must split that pass" >&2
  exit 2
fi
if [[ -e ${JSON.stringify(sidecar)} ]]; then
  echo "ht-agent still in usr/bin during linuxdeploy scan" >&2
  exit 3
fi
if [[ ! -e ${JSON.stringify(desktop)} ]]; then
  echo "harnesstap-desktop was incorrectly sheltered" >&2
  exit 4
fi
`,
    );
    await writeExecutable(
      join(pluginExtracted, "AppRun"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> ${JSON.stringify(pluginLog)}
if [[ ! -e ${JSON.stringify(sidecar)} ]]; then
  echo "ht-agent was not restored before plugin-appimage" >&2
  exit 5
fi
if [[ ! -e ${JSON.stringify(desktop)} ]]; then
  echo "harnesstap-desktop missing before plugin-appimage" >&2
  exit 6
fi
`,
    );

    const ldd = join(root, "ldd");
    await writeExecutable(
      ldd,
      `#!/usr/bin/env bash
set -euo pipefail
# Release #7: system ldd exits 0 on Bun --compile ht-agent.
echo "        libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6"
exit 0
`,
    );

    const proc = Bun.spawn(
      [
        "bash",
        WRAP,
        "--appimage-extract-and-run",
        "--verbosity",
        "1",
        "--appdir",
        appDir,
        "--plugin",
        "gtk",
        "--output",
        "appimage",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ""}`,
          LINUXDEPLOY_EXTRACTED_APPRUN: join(extracted, "AppRun"),
          LINUXDEPLOY_PLUGIN_APPIMAGE_APPRUN: join(pluginExtracted, "AppRun"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(stderr, `wrap stderr:\n${stderr}`).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Sheltering sidecar from linuxdeploy");

    expect(await Bun.file(sidecar).text()).toBe("sidecar-bytes");
    expect(await Bun.file(desktop).text()).toBe("desktop-bytes");

    const linuxdeployArgs = (await Bun.file(log).text()).trim();
    expect(linuxdeployArgs).toContain("--appdir");
    expect(linuxdeployArgs).toContain("--plugin gtk");
    expect(linuxdeployArgs).not.toContain("--appimage-extract-and-run");
    expect(linuxdeployArgs).not.toContain("--output");

    const pluginArgs = (await Bun.file(pluginLog).text()).trim();
    expect(pluginArgs).toContain("--appdir");
    expect(pluginArgs).not.toContain("--appimage-extract-and-run");
    expect(pluginArgs).not.toContain("--plugin");
  });

  test("shelters bunfs ELFs that are not named ht-agent", async () => {
    const root = await tempDir("linuxdeploy-wrap-bunfs-");
    const appDir = join(root, "HarnessTap.AppDir");
    const usrBin = join(appDir, "usr", "bin");
    await mkdir(usrBin, { recursive: true });
    const sidecar = join(usrBin, "other-agent");
    const desktop = join(usrBin, "harnesstap-desktop");
    await writeFile(sidecar, "ELF-header\nbunfs trailer\n");
    await writeFile(desktop, "desktop-bytes");
    await chmod(sidecar, 0o755);
    await chmod(desktop, 0o755);

    const extracted = join(root, "extracted");
    const pluginExtracted = join(root, "plugin-extracted");
    await mkdir(extracted);
    await mkdir(pluginExtracted);
    await writeExecutable(
      join(extracted, "AppRun"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ -e ${JSON.stringify(sidecar)} ]]; then
  echo "bunfs binary still in usr/bin during linuxdeploy scan" >&2
  exit 3
fi
if [[ ! -e ${JSON.stringify(desktop)} ]]; then
  echo "harnesstap-desktop was incorrectly sheltered" >&2
  exit 4
fi
`,
    );
    await writeExecutable(join(pluginExtracted, "AppRun"), "#!/usr/bin/env bash\nexit 0\n");
    await writeExecutable(
      join(root, "ldd"),
      `#!/usr/bin/env bash
echo "        libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6"
exit 0
`,
    );

    const proc = Bun.spawn(["bash", WRAP, "--appdir", appDir], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        LINUXDEPLOY_EXTRACTED_APPRUN: join(extracted, "AppRun"),
        LINUXDEPLOY_PLUGIN_APPIMAGE_APPRUN: join(pluginExtracted, "AppRun"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(stderr, `wrap stderr:\n${stderr}`).toBe("");
    expect(exitCode).toBe(0);
    expect(await Bun.file(sidecar).text()).toBe("ELF-header\nbunfs trailer\n");
    expect(await Bun.file(desktop).text()).toBe("desktop-bytes");
  });

  test("nested gtk re-invoke does not restore the sidecar early", async () => {
    const root = await tempDir("linuxdeploy-wrap-nested-");
    const appDir = join(root, "HarnessTap.AppDir");
    const usrBin = join(appDir, "usr", "bin");
    await mkdir(usrBin, { recursive: true });
    const sidecar = join(usrBin, "ht-agent");
    // Outer wrap already moved ht-agent aside; usr/bin must stay empty of it.

    const extracted = join(root, "extracted");
    const pluginExtracted = join(root, "plugin-extracted");
    await mkdir(extracted);
    await mkdir(pluginExtracted);
    const wrapLog = join(root, "wrap-nested.log");

    await writeExecutable(
      join(extracted, "AppRun"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ -z "\${LINUXDEPLOY_WRAP_ACTIVE:-}" ]]; then
  echo "expected LINUXDEPLOY_WRAP_ACTIVE during nested call" >&2
  exit 2
fi
if [[ -e ${JSON.stringify(sidecar)} ]]; then
  echo "ht-agent restored during nested gtk re-invoke" >&2
  exit 3
fi
echo nested >> ${JSON.stringify(wrapLog)}
`,
    );
    await writeExecutable(join(pluginExtracted, "AppRun"), "#!/usr/bin/env bash\nexit 0\n");
    await writeExecutable(
      join(root, "ldd"),
      `#!/usr/bin/env bash
echo "ldd: $1: not a dynamic executable" >&2
exit 1
`,
    );

    const nested = Bun.spawn(["bash", WRAP, "--appdir", appDir], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        LINUXDEPLOY_WRAP_ACTIVE: "1",
        LINUXDEPLOY_EXTRACTED_APPRUN: join(extracted, "AppRun"),
        LINUXDEPLOY_PLUGIN_APPIMAGE_APPRUN: join(pluginExtracted, "AppRun"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      nested.exited,
      new Response(nested.stderr).text(),
    ]);
    expect(stderr, `nested wrap stderr:\n${stderr}`).toBe("");
    expect(exitCode).toBe(0);
    expect((await Bun.file(wrapLog).text()).trim()).toBe("nested");
    expect(await Bun.file(sidecar).exists()).toBe(false);
  });
});
