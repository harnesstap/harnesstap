//! Replays `fixtures/picomatch.json`, recorded from picomatch by `make-fixtures.mjs`.

use serde::Deserialize;

#[derive(Deserialize)]
struct Fixtures {
    inputs: Vec<String>,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    pattern: String,
    source: Option<String>,
    error: Option<String>,
    matches: Option<String>,
}

fn load() -> Fixtures {
    // PICOMATCH_FIXTURE points at a larger local recording.
    let path = std::env::var("PICOMATCH_FIXTURE").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/picomatch.json").to_owned()
    });
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn regex_sources_match_byte_for_byte() {
    let f = load();
    let mut bad = Vec::new();
    for c in &f.cases {
        let got = picomatch_rs::make_re_source(&c.pattern).ok();
        if got != c.source {
            bad.push(format!(
                "{:?}\n  want {:?}\n  got  {:?}",
                c.pattern, c.source, got
            ));
        }
        assert!(c.error.is_none(), "{:?}", c.error);
    }
    assert!(
        bad.is_empty(),
        "{} of {} differ:\n{}",
        bad.len(),
        f.cases.len(),
        bad[..bad.len().min(15)].join("\n")
    );
}

#[test]
fn matchers_answer_the_same() {
    let f = load();
    let mut bad = Vec::new();
    for c in &f.cases {
        let m = picomatch_rs::Matcher::new(&c.pattern).unwrap();
        let got: String = f
            .inputs
            .iter()
            .map(|i| if m.is_match(i) { '1' } else { '0' })
            .collect();
        let want = c.matches.as_deref().unwrap();
        if got != want {
            let diff: Vec<String> = f
                .inputs
                .iter()
                .zip(got.chars().zip(want.chars()))
                .filter(|(_, (g, w))| g != w)
                .map(|(i, (_, w))| format!("{i:?}={w}"))
                .collect();
            bad.push(format!(
                "{:?} {:?} want {}",
                c.pattern,
                c.source,
                diff.join(" ")
            ));
        }
    }
    assert!(
        bad.is_empty(),
        "{} of {} differ:\n{}",
        bad.len(),
        f.cases.len(),
        bad[..bad.len().min(15)].join("\n")
    );
}
