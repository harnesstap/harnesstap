//! `a.localeCompare(b)` as Node and Bun run it: ICU collation for the
//! default locale (`en-US` here, which uses the CLDR root order) with default
//! options (tertiary strength, punctuation not ignored, no numeric ordering).
//!
//! ICU4X carries the same CLDR data as the ICU4C inside Node and Bun, so the
//! order matches for the strings the fixtures cover (ASCII, Latin accents,
//! Greek, CJK, emoji, ignorable controls and BOM). A CLDR version bump on
//! either side can move rare characters.

use icu_collator::options::CollatorOptions;
use icu_collator::{Collator, CollatorBorrowed};
use std::cmp::Ordering;

fn collator() -> &'static CollatorBorrowed<'static> {
    static COLLATOR: std::sync::OnceLock<CollatorBorrowed<'static>> = std::sync::OnceLock::new();
    COLLATOR.get_or_init(|| {
        // INFALLIBLE: the root collation data is compiled into the crate.
        #[expect(clippy::expect_used, reason = "compiled data always loads")]
        Collator::try_new(Default::default(), CollatorOptions::default())
            .expect("compiled collation data")
    })
}

/// `a.localeCompare(b)` as an ordering.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    collator().compare(a, b)
}

/// `[...items].sort((a, b) => a.localeCompare(b))`: stable, like V8 and JSC.
pub fn sort_locale<S: AsRef<str>>(items: &mut [S]) {
    items.sort_by(|a, b| locale_compare(a.as_ref(), b.as_ref()));
}
