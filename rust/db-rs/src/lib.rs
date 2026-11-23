//! The port of `src/db/` (ADR-012): rusqlite in place of `bun:sqlite` and
//! `better-sqlite3`.
//!
//! - [`paths`]: where the database and config live (`connection.ts`).
//! - [`connection`]: opening the database with the original's pragmas.
//! - [`schema`]: `initializeSchema` and every migration from v22 to v44.
//! - [`write_generation`]: which writes can change `ht status` output.
//!
//! `native-module.ts` has no counterpart: SQLite is linked in, so there is no
//! native module to fail to load.

pub mod connection;
pub mod paths;
pub mod schema;
mod schema_sql;
pub mod write_generation;
