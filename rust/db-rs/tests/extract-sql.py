"""Copies the SQL in src/db/schema.ts verbatim into src/schema_sql.rs.

Run from the repository root: python3 rust/db-rs/tests/extract-sql.py
Every multi-line template literal without `${` becomes a constant named after
the line it starts on, so the port cannot drift from the original's SQL.
"""

import re

src = open("src/db/schema.ts").read()
out = [
    "//! SQL copied verbatim from `src/db/schema.ts` by `tests/extract-sql.py`.",
    "//! Each constant is named after the line where its template literal starts.",
    "",
]
for m in re.finditer(r"`([^`]*)`", src):
    body = m.group(1)
    if "${" in body or body.count("\n") < 1:
        continue
    line = src.count("\n", 0, m.start()) + 1
    assert '"#' not in body
    out.append(f'pub const L{line}: &str = r#"{body}"#;')
    out.append("")
open("rust/db-rs/src/schema_sql.rs", "w").write("\n".join(out))
