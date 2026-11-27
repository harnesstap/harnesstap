//! Compares the Rust registry with the one recorded from the original.

use platforms_rs::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/registry.json")).unwrap()
}

#[test]
fn platforms_match_the_original() {
    let f = fixture();
    let ours = serde_json::to_value(get_all_platforms()).unwrap();
    let theirs = f["platforms"].as_array().unwrap();
    assert_eq!(ours.as_array().unwrap().len(), theirs.len());
    for (a, b) in ours.as_array().unwrap().iter().zip(theirs) {
        assert_eq!(a, b, "platform {}", b["id"]);
    }
    assert_eq!(json!(get_platform_ids()), f["ids"]);
}

#[test]
fn lookups_match_the_original() {
    for case in fixture()["lookups"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        assert_eq!(json!(get_platform(id).map(|p| p.id)), case["found"], "{id}");
    }
    assert!(get_platform("cursor").unwrap().supports("skills"));
    assert!(detect_platforms("/any").is_empty());
}

#[test]
fn resource_classes_match_the_original() {
    let f = fixture();
    let mut ours = serde_json::Map::new();
    for (t, c) in RESOURCE_CLASSES {
        ours.insert(t.to_owned(), json!(c));
    }
    assert_eq!(Value::Object(ours), f["resourceClasses"]);
    for call in f["resourceClassCalls"].as_array().unwrap() {
        assert_eq!(json!(resource_class(call[0].as_str().unwrap())), call[1]);
    }
    assert_eq!(resource_class("plugin"), None);
}
