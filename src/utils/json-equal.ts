function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key, index) => {
      const otherKey = rightKeys[index];
      return (
        otherKey !== undefined
        && key === otherKey
        && jsonValuesEqual(leftRecord[key], rightRecord[key])
      );
    });
  }
  return false;
}

/** True when both strings parse as JSON and the values are deeply equal. */
export function jsonContentsEquivalent(left: string, right: string): boolean {
  try {
    return jsonValuesEqual(JSON.parse(left) as unknown, JSON.parse(right) as unknown);
  } catch {
    return false;
  }
}
