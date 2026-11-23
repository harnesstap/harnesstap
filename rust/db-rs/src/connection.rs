//! The port of `getDb` and `readDbDataVersion` from `src/db/connection.ts`.

use crate::paths::{self, Env};
use crate::write_generation::WriteGeneration;
use rusqlite::{Connection, OpenFlags};

/// An open HarnessTap database and its status write counter.
pub struct Db {
    pub conn: Connection,
    pub path: String,
    pub generation: WriteGeneration,
}

fn completion_mode(env: &dyn Env) -> bool {
    env.var("HARNESSTAP_COMPLETE").as_deref() == Some("1")
}

/// `getDb`: open `harnesstap.db`, read-only in shell-completion mode
/// (`HARNESSTAP_COMPLETE=1`), where a missing database is an error and nothing
/// is created.
pub fn open(env: &dyn Env) -> Result<Db, String> {
    let path = paths::db_path(env);
    let completion = completion_mode(env);
    if completion {
        if !std::path::Path::new(&path).exists() {
            return Err(format!("HarnessTap database not found: {path}"));
        }
    } else {
        std::fs::create_dir_all(paths::harnesstap_dir(env)).map_err(|e| e.to_string())?;
    }
    let conn = if completion {
        Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
    } else {
        Connection::open(&path)
    }
    .map_err(|e| e.to_string())?;
    if !completion {
        // `journal_mode` answers with a row, so it cannot go through `execute_batch`.
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA busy_timeout = 5000")
            .map_err(|e| e.to_string())?;
    }
    conn.execute_batch("PRAGMA foreign_keys = ON")
        .map_err(|e| e.to_string())?;
    Ok(Db {
        conn,
        path,
        generation: WriteGeneration::default(),
    })
}

/// `readDbDataVersion`: moves when another connection commits; -1 on error.
pub fn data_version(db: &Db) -> i64 {
    db.conn
        .query_row("PRAGMA data_version", [], |row| row.get::<_, i64>(0))
        .unwrap_or(-1)
}
