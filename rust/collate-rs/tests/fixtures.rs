//! Compares `locale_compare` with Node's `localeCompare`.

use std::cmp::Ordering;

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/collate.json")).unwrap()
}

fn s(v: &serde_json::Value) -> String {
    v.as_str().unwrap().to_owned()
}

#[test]
fn pairs_match_node() {
    let f = fixture();
    let mut bad = Vec::new();
    for p in f["pairs"].as_array().unwrap() {
        let (a, b) = (s(&p[0]), s(&p[1]));
        let want = match p[2].as_i64().unwrap() {
            -1 => Ordering::Less,
            0 => Ordering::Equal,
            _ => Ordering::Greater,
        };
        if collate_rs::locale_compare(&a, &b) != want {
            bad.push(format!("{a:?} vs {b:?}: want {want:?}"));
        }
    }
    assert!(
        bad.is_empty(),
        "{} mismatches:\n{}",
        bad.len(),
        bad[..bad.len().min(30)].join("\n")
    );
}

#[test]
fn sort_matches_node() {
    let f = fixture();
    let mut items: Vec<String> = f["input"].as_array().unwrap().iter().map(s).collect();
    collate_rs::sort_locale(&mut items);
    let want: Vec<String> = f["sorted"].as_array().unwrap().iter().map(s).collect();
    assert_eq!(items, want);
}
