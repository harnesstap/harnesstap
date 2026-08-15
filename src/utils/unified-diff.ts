/**
 * Line-oriented unified diff (git-style +/-) from live content to after-apply content.
 */

export type UnifiedDiffLineKind = "meta" | "hunk" | "context" | "add" | "remove";

export interface UnifiedDiffLine {
  kind: UnifiedDiffLineKind;
  text: string;
}

type Op = { kind: "equal" | "insert" | "delete"; line: string };

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const parts = text.split("\n");
  if (text.endsWith("\n")) {
    return parts.slice(0, -1);
  }
  return parts;
}

/** Classic LCS → per-line equal/insert/delete ops. */
function computeOps(oldLines: string[], newLines: string[]): Op[] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: "equal", line: oldLines[i]! });
      i++;
      j++;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      ops.push({ kind: "delete", line: oldLines[i]! });
      i++;
    } else {
      ops.push({ kind: "insert", line: newLines[j]! });
      j++;
    }
  }
  while (i < m) {
    ops.push({ kind: "delete", line: oldLines[i]! });
    i++;
  }
  while (j < n) {
    ops.push({ kind: "insert", line: newLines[j]! });
    j++;
  }
  return ops;
}

function advanceLine(op: Op, oldLine: number, newLine: number): {
  oldLine: number;
  newLine: number;
} {
  switch (op.kind) {
    case "equal":
      return { oldLine: oldLine + 1, newLine: newLine + 1 };
    case "delete":
      return { oldLine: oldLine + 1, newLine };
    case "insert":
      return { oldLine, newLine: newLine + 1 };
    default: {
      const _never: never = op.kind;
      return _never;
    }
  }
}

/**
 * Build unified-diff lines: live (from) → after-apply (to).
 */
export function buildUnifiedDiffLines(
  path: string,
  from: string,
  to: string,
  contextLines = 3,
): UnifiedDiffLine[] {
  const ops = computeOps(splitLines(from), splitLines(to));
  const result: UnifiedDiffLine[] = [
    { kind: "meta", text: `--- live/${path}` },
    { kind: "meta", text: `+++ after-apply/${path}` },
  ];

  if (ops.every((op) => op.kind === "equal")) {
    result.push({ kind: "meta", text: "(no content differences)" });
    return result;
  }

  // Include change ops plus ±contextLines of surrounding equal lines.
  const include = new Array<boolean>(ops.length).fill(false);
  for (let index = 0; index < ops.length; index++) {
    if (ops[index]!.kind === "equal") {
      continue;
    }
    include[index] = true;
    let before = 0;
    for (let k = index - 1; k >= 0 && before < contextLines; k--) {
      include[k] = true;
      if (ops[k]!.kind === "equal") {
        before++;
      }
    }
    let after = 0;
    for (let k = index + 1; k < ops.length && after < contextLines; k++) {
      include[k] = true;
      if (ops[k]!.kind === "equal") {
        after++;
      }
    }
  }

  let opIndex = 0;
  let oldLine = 1;
  let newLine = 1;

  while (opIndex < ops.length) {
    if (!include[opIndex]) {
      const advanced = advanceLine(ops[opIndex]!, oldLine, newLine);
      oldLine = advanced.oldLine;
      newLine = advanced.newLine;
      opIndex++;
      continue;
    }

    const hunkStart = opIndex;
    const hunkOldStart = oldLine;
    const hunkNewStart = newLine;
    while (opIndex < ops.length && include[opIndex]) {
      opIndex++;
    }
    const hunkEnd = opIndex;

    let oldCount = 0;
    let newCount = 0;
    const body: UnifiedDiffLine[] = [];
    for (let k = hunkStart; k < hunkEnd; k++) {
      const op = ops[k]!;
      switch (op.kind) {
        case "equal":
          body.push({ kind: "context", text: ` ${op.line}` });
          oldCount++;
          newCount++;
          break;
        case "delete":
          body.push({ kind: "remove", text: `-${op.line}` });
          oldCount++;
          break;
        case "insert":
          body.push({ kind: "add", text: `+${op.line}` });
          newCount++;
          break;
        default: {
          const _never: never = op.kind;
          return _never;
        }
      }
      const advanced = advanceLine(op, oldLine, newLine);
      oldLine = advanced.oldLine;
      newLine = advanced.newLine;
    }

    result.push({
      kind: "hunk",
      text: `@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`,
    });
    result.push(...body);
  }

  return result;
}

export function countUnifiedDiffChanges(lines: UnifiedDiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    switch (line.kind) {
      case "add":
        added++;
        break;
      case "remove":
        removed++;
        break;
      case "meta":
      case "hunk":
      case "context":
        break;
      default: {
        const _never: never = line.kind;
        return _never;
      }
    }
  }
  return { added, removed };
}
