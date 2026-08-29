import type { LockEntry, Lockfile } from "../lockfile.js";
import {
  LICENSE_KIND_EXPRESSION,
  LICENSE_KIND_ID,
  LICENSE_KIND_NAMED,
  classifyDeclaredLicense,
} from "./license.js";
import {
  buildPurl,
  componentName,
  componentVersion,
  scrubUrl,
} from "./purl.js";

export const FORMAT_CYCLONEDX = "cyclonedx";
export const FORMAT_SPDX = "spdx";
export const SUPPORTED_SBOM_FORMATS = [FORMAT_CYCLONEDX, FORMAT_SPDX] as const;

export type SbomFormat = (typeof SUPPORTED_SBOM_FORMATS)[number];

export class LockExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockExportError";
  }
}

const NOASSERTION = "NOASSERTION";

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareKey(left, right))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sha256Digest(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const hex = value.replace(/^sha256:/i, "");
  return /^[0-9a-f]{64}$/i.test(hex) ? hex.toLowerCase() : undefined;
}

function recordedHash(entry: LockEntry): string | undefined {
  return sha256Digest(entry.content_hash) ?? sha256Digest(entry.integrity);
}

function sortedEntries(lock: Lockfile): Array<{ purl: string; entry: LockEntry }> {
  return [...lock.plugins]
    .map((entry) => ({ purl: buildPurl(entry), entry }))
    .sort((left, right) => compareKey(left.purl, right.purl));
}

function cyclonedxLicenses(declared: string | undefined): unknown[] | undefined {
  if (!declared) {
    return undefined;
  }
  const classified = classifyDeclaredLicense(declared);
  switch (classified.kind) {
    case LICENSE_KIND_ID:
      return [{ license: { id: classified.value } }];
    case LICENSE_KIND_EXPRESSION:
      return [{ expression: classified.value }];
    case LICENSE_KIND_NAMED:
      return [{ license: { name: classified.value } }];
    default: {
      const unhandled: never = classified.kind;
      return unhandled;
    }
  }
}

function cyclonedxHashes(entry: LockEntry): Array<{ alg: string; content: string }> | undefined {
  const digest = recordedHash(entry);
  if (!digest) {
    return undefined;
  }
  return [{ alg: "SHA-256", content: digest }];
}

function spdxChecksums(entry: LockEntry): Array<{ algorithm: string; checksumValue: string }> | undefined {
  const digest = recordedHash(entry);
  if (!digest) {
    return undefined;
  }
  return [{ algorithm: "SHA256", checksumValue: digest }];
}

function buildCycloneDx(lock: Lockfile, timestamp: string): unknown {
  const components = sortedEntries(lock).map(({ purl, entry }) => {
    const component: Record<string, unknown> = {
      type: "library",
      name: componentName(entry),
      purl,
      "bom-ref": purl,
    };
    const version = componentVersion(entry);
    if (version) {
      component.version = version;
    }
    const licenses = cyclonedxLicenses(entry.declared_license);
    if (licenses) {
      component.licenses = licenses;
    }
    const hashes = cyclonedxHashes(entry);
    if (hashes) {
      component.hashes = hashes;
    }
    if (entry.repo_url) {
      const url = scrubUrl(entry.repo_url);
      if (url.includes("://")) {
        component.externalReferences = [{ type: "distribution", url }];
      }
    }
    return component;
  });

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp,
      tools: [{ vendor: "HarnessTap", name: "ht lock export" }],
    },
    components,
  };
}

function buildSpdx(lock: Lockfile, timestamp: string): unknown {
  const packages = sortedEntries(lock).map(({ purl, entry }, index) => {
    const download = entry.repo_url && entry.repo_url.includes("://")
      ? scrubUrl(entry.repo_url)
      : NOASSERTION;
    const pkg: Record<string, unknown> = {
      SPDXID: `SPDXRef-Package-${index}`,
      name: componentName(entry),
      downloadLocation: download || NOASSERTION,
      licenseConcluded: NOASSERTION,
      licenseDeclared: entry.declared_license ?? NOASSERTION,
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: purl,
        },
      ],
    };
    const version = componentVersion(entry);
    if (version) {
      pkg.versionInfo = version;
    }
    const checksums = spdxChecksums(entry);
    if (checksums) {
      pkg.checksums = checksums;
    }
    return pkg;
  });

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "harnesstap-sbom",
    documentNamespace: `https://spdx.org/spdxdocs/harnesstap-sbom-${timestamp}`,
    creationInfo: {
      created: timestamp,
      creators: ["Tool: ht lock export"],
    },
    packages,
  };
}

export function parseSbomFormat(value: string | undefined): SbomFormat {
  const normalized = (value ?? FORMAT_CYCLONEDX).toLowerCase();
  switch (normalized) {
    case FORMAT_CYCLONEDX:
    case FORMAT_SPDX:
      return normalized;
    default:
      throw new LockExportError(
        `Unsupported SBOM format: ${value}. Use cyclonedx or spdx.`,
      );
  }
}

export function exportSbom(lock: Lockfile, format: SbomFormat, timestamp: string): string {
  switch (format) {
    case FORMAT_CYCLONEDX:
      return stableStringify(buildCycloneDx(lock, timestamp));
    case FORMAT_SPDX:
      return stableStringify(buildSpdx(lock, timestamp));
    default: {
      const unhandled: never = format;
      throw new LockExportError(`Unsupported SBOM format: ${String(unhandled)}`);
    }
  }
}
