---
description: Export a CycloneDX or SPDX SBOM inventory from apm.lock.yaml.
---

# Export a lockfile SBOM (Use)

`ht lock export` serializes the existing `apm.lock.yaml` into a CycloneDX 1.5 or SPDX 2.3 document. It is an inventory export, not a security attestation: it reads the lockfile only and never re-resolves, re-hashes, or touches the network.

```bash
ht lock export
ht lock export --format cyclonedx -o sbom.json
ht lock export --format spdx | jq '.packages | length'
ht lock export --timestamp 2024-06-01T00:00:00+00:00
```

Missing lockfile fails closed. Diagnostics go to stderr so `ht lock export | jq` stays clean. Two runs with the same `--timestamp` are byte-identical.

This document is unsigned and does not claim SLSA. See [Command reference](../command-reference.md#lock-export).
