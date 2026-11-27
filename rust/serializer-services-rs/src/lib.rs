//! Services the harness writers (`src/platforms/*.ts`) call, one module per file as they are
//! ported. Replayed against recordings of the TypeScript by `tests/make-fixtures.mjs`.

#![forbid(unsafe_code)]

pub mod mcp_target;
pub mod skill_command_metadata;
