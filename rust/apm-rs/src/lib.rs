//! The apm services, `src/services/apm-*.ts`, one module per file as they are ported.
//! Replayed against recordings of the TypeScript by `tests/make-fixtures.ts`.

#![forbid(unsafe_code)]

pub mod dependencies;
pub mod git_resolve;
pub mod hook_serialization;
pub mod overlay;
pub mod policy;
pub mod skill_auxiliary;
pub mod targets;
