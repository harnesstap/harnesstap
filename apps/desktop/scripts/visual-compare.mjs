import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/** Fraction of pixels that may differ (0.2%). */
export const DEFAULT_MAX_RATIO = 0.002;

/** pixelmatch per-pixel color threshold (0–1). */
export const PIXEL_THRESHOLD = 0.1;

export function decodePng(buffer) {
  return PNG.sync.read(buffer);
}

export function solidPng(width, height, fill) {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = fill[0];
    image.data[i + 1] = fill[1];
    image.data[i + 2] = fill[2];
    image.data[i + 3] = fill[3];
  }
  return PNG.sync.write(image);
}

export function mismatchRatio(actual, baseline, { threshold = PIXEL_THRESHOLD } = {}) {
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return 1;
  }
  const diffCount = pixelmatch(
    actual.data,
    baseline.data,
    null,
    actual.width,
    actual.height,
    { threshold },
  );
  return diffCount / (actual.width * actual.height);
}

export function compareShot(actualPath, baselinePath, options = {}) {
  const maxRatio = options.maxRatio ?? DEFAULT_MAX_RATIO;
  const diffPath = options.diffPath;
  if (!existsSync(baselinePath)) {
    return {
      ok: false,
      ratio: 1,
      reason: `missing baseline ${baselinePath}`,
    };
  }
  if (!existsSync(actualPath)) {
    return {
      ok: false,
      ratio: 1,
      reason: `missing actual ${actualPath}`,
    };
  }
  const actual = decodePng(readFileSync(actualPath));
  const baseline = decodePng(readFileSync(baselinePath));
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return {
      ok: false,
      ratio: 1,
      reason: `size ${actual.width}x${actual.height} vs ${baseline.width}x${baseline.height}`,
    };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffCount = pixelmatch(
    actual.data,
    baseline.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: PIXEL_THRESHOLD },
  );
  const ratio = diffCount / (actual.width * actual.height);
  if (ratio > maxRatio && diffPath) {
    mkdirSync(path.dirname(diffPath), { recursive: true });
    writeFileSync(diffPath, PNG.sync.write(diff));
  }
  return {
    ok: ratio <= maxRatio,
    ratio,
    reason: ratio > maxRatio ? `mismatch ${(ratio * 100).toFixed(3)}%` : null,
  };
}

export function baselinePathFor(shotFile, baselineDir) {
  return path.join(baselineDir, path.basename(shotFile));
}
