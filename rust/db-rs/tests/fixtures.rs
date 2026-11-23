//! Replays what the original's db layer did (`make-fixtures.ts`): every
//! schema scenario ends in the same tables, columns, rows and errors.

use db_rs::schema::{InitializeSchemaOptions, initialize_schema};
use rusqlite::Connection;
use rusqlite::types::Value as Sql;
use serde_json::{Map, Value, json};

fn to_json(v: Sql) -> Value {
    match v {
        Sql::Null => Value::Null,
        Sql::Integer(n) => json!(n),
        Sql::Real(f) => json!(f),
        Sql::Text(s) => Value::String(s),
        Sql::Blob(b) => json!(b),
    }
}

fn query(conn: &Connection, sql: &str) -> Vec<Map<String, Value>> {
    let mut stmt = conn.prepare(sql).unwrap();
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    stmt.query_map([], |row| {
        let mut map = Map::new();
        for (i, name) in names.iter().enumerate() {
            map.insert(name.clone(), to_json(row.get::<_, Sql>(i)?));
        }
        Ok(map)
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

fn dump(conn: &Connection) -> Value {
    let master = query(
        conn,
        "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
    );
    let tables: Vec<Value> = query(
        conn,
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .into_iter()
    .map(|t| {
        let name = t["name"].as_str().unwrap().to_owned();
        let columns = query(conn, &format!("PRAGMA table_info(\"{name}\")"));
        let mut rows: Vec<String> = query(conn, &format!("SELECT * FROM \"{name}\""))
            .into_iter()
            .map(|row| emit_rs::json::stringify(&Value::Object(row), ""))
            .collect();
        rows.sort();
        json!({ "name": name, "columns": columns, "rows": rows })
    })
    .collect();
    json!({ "master": master, "tables": tables })
}

fn sorted_rows(mut dump: Value) -> Value {
    for table in dump["tables"].as_array_mut().unwrap() {
        table["rows"]
            .as_array_mut()
            .unwrap()
            .sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    dump
}

#[test]
fn schema_matches_the_original() {
    let scenarios: Vec<Value> = serde_json::from_str(include_str!("fixtures/schema.json")).unwrap();
    assert!(scenarios.len() > 20);
    let mut failures = Vec::new();
    for s in &scenarios {
        let name = s["name"].as_str().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        if s["init"].as_bool() == Some(true) {
            initialize_schema(&conn, InitializeSchemaOptions::default()).unwrap();
        }
        conn.execute_batch(s["setup"].as_str().unwrap()).unwrap();
        let options = InitializeSchemaOptions {
            allow_legacy_read: s["allowLegacyRead"].as_bool() == Some(true),
        };
        let error = initialize_schema(&conn, options).err();
        if error.as_deref() != s["error"].as_str() {
            failures.push(format!("{name}: error {error:?}, expected {}", s["error"]));
            continue;
        }
        let actual = dump(&conn);
        let expected = sorted_rows(s["dump"].clone());
        if actual != expected {
            let (a, e) = (actual.to_string(), expected.to_string());
            let at = a
                .bytes()
                .zip(e.bytes())
                .position(|(x, y)| x != y)
                .unwrap_or(0);
            let from = at.saturating_sub(200);
            failures.push(format!(
                "{name}: dump differs at byte {at}\n  actual:   {}\n  expected: {}",
                &a[from..(at + 200).min(a.len())],
                &e[from..(at + 200).min(e.len())]
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn status_writes_match_the_original() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/statements.json")).unwrap();
    for c in &cases {
        let sql = c["sql"].as_str().unwrap();
        assert_eq!(
            db_rs::write_generation::statement_affects_status(sql),
            c["affects"].as_bool().unwrap(),
            "{sql:?}"
        );
    }
}

#[test]
fn paths_match_the_original() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/paths.json")).unwrap();
    for c in &cases {
        let env = c["env"].as_object().unwrap().clone();
        let lookup = move |name: &str| env.get(name).and_then(Value::as_str).map(str::to_owned);
        assert_eq!(
            db_rs::paths::harnesstap_dir(&lookup),
            c["dir"],
            "{}",
            c["env"]
        );
        assert_eq!(db_rs::paths::db_path(&lookup), c["db"]);
        assert_eq!(db_rs::paths::config_jsonc_path(&lookup), c["configJsonc"]);
        assert_eq!(db_rs::paths::legacy_config_path(&lookup), c["legacyConfig"]);
        assert_eq!(
            db_rs::paths::harnesstap_dir_for_home_root(&lookup, "/root/x/../y"),
            c["forHomeRoot"]
        );
    }
}

#[test]
fn opens_a_database_like_get_db() {
    let home = std::env::temp_dir().join(format!("db-rs-test-{}", std::process::id()));
    let dir = home.join("ht").to_string_lossy().into_owned();
    let env = move |name: &str| (name == "HARNESSTAP_HOME").then(|| dir.clone());
    let db = db_rs::connection::open(&env).unwrap();
    initialize_schema(&db.conn, InitializeSchemaOptions::default()).unwrap();
    let mode: String = db
        .conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    assert!(db_rs::connection::data_version(&db) >= 0);
    drop(db);
    let complete = {
        let dir = home.join("missing").to_string_lossy().into_owned();
        move |name: &str| match name {
            "HARNESSTAP_HOME" => Some(dir.clone()),
            "HARNESSTAP_COMPLETE" => Some("1".to_owned()),
            _ => None,
        }
    };
    let error = db_rs::connection::open(&complete).err().unwrap();
    assert!(error.starts_with("HarnessTap database not found: "));
    std::fs::remove_dir_all(&home).unwrap();
}
