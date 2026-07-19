#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/docs/scenarios/vhs/scenarios.json"
MODE="render"
SCENARIO=""
NO_BUILD=0

while (($#)); do
  case "$1" in
    --list)
      MODE="list"
      shift
      ;;
    --scenario)
      SCENARIO="${2:?missing scenario value}"
      shift 2
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

readarray -t SCENARIOS < <(node - <<'NODE' "$MANIFEST" "$SCENARIO"
const fs = require("node:fs");
const [manifestPath, selected] = process.argv.slice(2);
const definitions = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
for (const definition of definitions) {
  const key = `${String(definition.id).padStart(2, "0")}-${definition.slug}`;
  if (!selected || selected === key || selected === definition.slug || selected === String(definition.id)) {
    console.log([
      key,
      definition.tapePath,
      definition.outputPath,
      definition.fixturePath ?? "",
    ].join("\t"));
  }
}
NODE
)

if [[ "$MODE" == "list" ]]; then
  printf '%s\n' "${SCENARIOS[@]}"
  exit 0
fi

command -v bun >/dev/null || { echo "bun is required" >&2; exit 1; }
command -v vhs >/dev/null || { echo "vhs is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v ttyd >/dev/null || { echo "ttyd is required" >&2; exit 1; }

if [[ "$NO_BUILD" -eq 0 ]]; then
  bun run build >/dev/null
fi

prepare_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "demo@example.com"
  git -C "$dir" config user.name "HarnessTap Demo"
  git -C "$dir" remote add origin "git@github.com:acme/harnesstap-demo.git"
  git -C "$dir" add -A
  git -C "$dir" commit --allow-empty -q -m "init"
}

create_vhs_commands() {
  local bin_dir="$1"
  local home_dir="$2"
  local hd_dir="$3"
  local project_dir="$4"

  cat >"$bin_dir/harnesstap" <<EOF
#!/usr/bin/env bash
export HOME="$home_dir"
export HARNESSTAP_HOME="$hd_dir"
export HARNESSTAP_NO_INTERACTIVE=1
cd "$project_dir"
exec node "$ROOT/dist/index.js" "\$@"
EOF

  cp "$bin_dir/harnesstap" "$bin_dir/ht"
  chmod +x "$bin_dir/harnesstap" "$bin_dir/ht"
}

cd "$ROOT"

for row in "${SCENARIOS[@]}"; do
  IFS=$'\t' read -r key tape output fixture <<<"$row"
  work_root="$(mktemp -d "${TMPDIR:-/tmp}/harnesstap-vhs-${key}-XXXX")"
  bin_dir="$work_root/bin"
  home_dir="$work_root/home"
  hd_dir="$work_root/harnesstap-home"
  project_dir="$work_root/project"
  mkdir -p "$bin_dir" "$home_dir" "$hd_dir" "$project_dir"

  if [[ -n "$fixture" ]]; then
    cp -R "$ROOT/$fixture/." "$project_dir/"
  fi

  prepare_git_repo "$project_dir"
  create_vhs_commands "$bin_dir" "$home_dir" "$hd_dir" "$project_dir"

  PATH="$bin_dir:$PATH" \
  HOME="$home_dir" \
  HARNESSTAP_HOME="$hd_dir" \
  HARNESSTAP_NO_INTERACTIVE=1 \
  HT_PROJECT_ROOT="$project_dir" \
  HT_SCENARIO_KEY="$key" \
  vhs "$ROOT/$tape"

  rm -rf "$work_root"
done
