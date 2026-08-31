import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "reseal-macos-app.sh");
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

async function makeBundle(root: string): Promise<{ bundle: string; app: string; dmg: string }> {
  const bundle = join(root, "bundle");
  const macosDir = join(bundle, "macos", "HarnessTap.app", "Contents", "MacOS");
  const dmgDir = join(bundle, "dmg");
  await mkdir(macosDir, { recursive: true });
  await mkdir(dmgDir, { recursive: true });
  await writeFile(join(macosDir, "harnesstap-desktop"), "desktop-bin");
  await writeFile(join(macosDir, "ht-agent"), "sidecar-bin");
  const dmg = join(dmgDir, "HarnessTap_1.0.2_aarch64.dmg");
  await writeFile(dmg, "stale-unsealed-dmg");
  return { bundle, app: join(bundle, "macos", "HarnessTap.app"), dmg };
}

describe("reseal-macos-app.sh", () => {
  test("skips on non-Darwin unless RESEAL_REQUIRE=1", async () => {
    const root = await tempDir("reseal-skip-");
    const proc = Bun.spawn(["/bin/bash", SCRIPT, join(root, "missing")], {
      cwd: root,
      env: { ...process.env, RESEAL_UNAME: "Linux" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("skipping on Linux");

    const required = Bun.spawn(["/bin/bash", SCRIPT, join(root, "missing")], {
      cwd: root,
      env: { ...process.env, RESEAL_UNAME: "Linux", RESEAL_REQUIRE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [reqExit, reqErr] = await Promise.all([
      required.exited,
      new Response(required.stderr).text(),
    ]);
    expect(reqExit).toBe(1);
    expect(reqErr).toContain("required on Darwin");
  });

  test("signs nested binaries, reseals the app, and recreates existing DMGs", async () => {
    const root = await tempDir("reseal-ok-");
    const { bundle, app, dmg } = await makeBundle(root);
    const signLog = join(root, "codesign.log");
    const hdiLog = join(root, "hdiutil.log");

    await writeExecutable(
      join(root, "codesign"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> ${JSON.stringify(signLog)}
if [[ " $* " == *" -dv "* ]]; then
  echo "Identifier=dev.harnesstap.desktop" >&2
  echo "Sealed Resources version=2 rules=13 files=42" >&2
  exit 0
fi
exit 0
`,
    );
    await writeExecutable(
      join(root, "hdiutil"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> ${JSON.stringify(hdiLog)}
out=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-ov" || "$prev" == "UDZO" ]]; then
    :
  fi
  prev="$arg"
done
out="\${@: -1}"
mkdir -p "$(dirname "$out")"
echo sealed-dmg > "$out"
exit 0
`,
    );

    const proc = Bun.spawn(["/bin/bash", SCRIPT, bundle], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}:/usr/bin:/bin:${process.env.PATH ?? ""}`,
        RESEAL_UNAME: "Darwin",
        RESEAL_REQUIRE: "1",
        RESEAL_CODESIGN: join(root, "codesign"),
        RESEAL_HDIUTIL: join(root, "hdiutil"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(stderr, `reseal stderr:\n${stderr}`).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("sealed HarnessTap.app (Sealed Resources present)");
    expect(stdout).toContain("recreating HarnessTap_1.0.2_aarch64.dmg from sealed app");

    const signed = (await Bun.file(signLog).text()).trim().split("\n");
    expect(signed.some((line) => line.includes("ht-agent") && line.includes("--force"))).toBe(true);
    expect(signed.some((line) => line.includes("harnesstap-desktop"))).toBe(true);
    expect(signed.some((line) => line.includes("--deep") && line.includes(app))).toBe(true);
    expect(signed.some((line) => line.includes("-dv"))).toBe(true);

    const hdi = (await Bun.file(hdiLog).text()).trim();
    expect(hdi).toContain("-volname HarnessTap");
    expect(hdi).toContain("-format UDZO");
    expect(hdi).toContain(dmg);
    expect(await Bun.file(dmg).text()).toBe("sealed-dmg\n");
  });

  test("fails when codesign still reports Sealed Resources=none", async () => {
    const root = await tempDir("reseal-none-");
    const { bundle } = await makeBundle(root);
    await writeExecutable(
      join(root, "codesign"),
      `#!/usr/bin/env bash
if [[ " $* " == *" -dv "* ]]; then
  echo "Sealed Resources=none" >&2
  exit 0
fi
exit 0
`,
    );
    await writeExecutable(join(root, "hdiutil"), "#!/usr/bin/env bash\nexit 0\n");

    const proc = Bun.spawn(["/bin/bash", SCRIPT, bundle], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}:/usr/bin:/bin:${process.env.PATH ?? ""}`,
        RESEAL_UNAME: "Darwin",
        RESEAL_CODESIGN: join(root, "codesign"),
        RESEAL_HDIUTIL: join(root, "hdiutil"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Sealed Resources=none after reseal");
  });
});
