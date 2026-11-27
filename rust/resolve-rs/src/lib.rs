//! The version side of `src/services/resolve`: `plugin-constraints.ts`, `version-mediation.ts` and
//! the `UnsatisfiableConstraintError` from `types.ts`. Replayed against recordings of the
//! TypeScript by `tests/make-fixtures.ts`.

#![forbid(unsafe_code)]

pub mod plugin_constraints;
pub mod types;
pub mod version_mediation;

/// `String.prototype.trim`.
pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| {
        matches!(
            c,
            '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
                ..='\u{200A}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202F}'
                    | '\u{205F}'
                    | '\u{3000}'
                    | '\u{FEFF}'
        )
    })
}
