//! The port of `src/models/`: typed access to the HarnessTap database.
//!
//! Every function takes a [`Ctx`]: the database, the environment, and the
//! clock and id source that the original reads from `new Date()` and `ulid()`.
//! Tests pass fixed ones, the way the original's tests pin them.

pub mod apply_removal_backup;
pub mod global_apply_snapshot;
pub mod imported_snapshot;
pub mod package_cache_entry;
pub mod plugin_pin_materialization;
pub mod preexisting_path;
pub mod project;
pub mod resource_materialization;
pub mod snapshot;

use db_rs::connection::Db;
use db_rs::paths::Env;
use rusqlite::{Params, Row};

pub type Result<T> = std::result::Result<T, String>;

/// `new Date().toISOString()`.
pub trait Clock {
    fn now_iso(&self) -> String;
}

/// `ulid()`.
pub trait Ids {
    fn ulid(&self) -> String;
}

/// The system clock, printed like `Date.prototype.toISOString`.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_iso(&self) -> String {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        iso_from_millis(ms)
    }
}

/// `Date.prototype.toISOString` for a time in milliseconds since the epoch
/// (years 0 to 9999).
pub fn iso_from_millis(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    // civil_from_days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Random ULIDs, like `ulid()` (not monotonic within a millisecond).
pub struct UlidIds;

impl Ids for UlidIds {
    fn ulid(&self) -> String {
        ulid::Ulid::new().to_string()
    }
}

/// What every model function works against.
pub struct Ctx<'a> {
    pub db: &'a Db,
    pub env: &'a dyn Env,
    pub clock: &'a dyn Clock,
    pub ids: &'a dyn Ids,
}

pub(crate) fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// `prepare(sql).get(...)`.
pub(crate) fn get<T, P: Params>(
    db: &Db,
    sql: &str,
    params: P,
    map: impl FnOnce(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Option<T>> {
    let mut stmt = db.conn.prepare_cached(sql).map_err(err)?;
    let mut rows = stmt.query(params).map_err(err)?;
    match rows.next().map_err(err)? {
        Some(row) => map(row).map(Some).map_err(err),
        None => Ok(None),
    }
}

/// `prepare(sql).all(...)`.
pub(crate) fn all<T, P: Params>(
    db: &Db,
    sql: &str,
    params: P,
    map: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>> {
    let mut stmt = db.conn.prepare_cached(sql).map_err(err)?;
    let rows = stmt.query_map(params, map).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[cfg(test)]
mod tests {
    #[test]
    fn prints_iso_like_javascript() {
        assert_eq!(super::iso_from_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            super::iso_from_millis(1_767_225_600_123),
            "2026-01-01T00:00:00.123Z"
        );
        assert_eq!(
            super::iso_from_millis(951_782_400_000),
            "2000-02-29T00:00:00.000Z"
        );
    }
}
