//! The version side of `src/services/resolve`: `plugin-constraints.ts`, `version-mediation.ts` and
//! the errors (`UnsatisfiableConstraintError`, `SingletonConflictError` and its conflict labels)
//! and resolution types from `types.ts`, and the key and fingerprint helpers of
//! `resource-resolution.ts`. The passes that read the database (`dependency-graph.ts`,
//! `resolveResources` and `index.ts`) live in `plugin-model-rs` (`resolve` module). Replayed
//! against recordings of the TypeScript by `tests/make-fixtures.ts`.

#![forbid(unsafe_code)]

pub mod plugin_constraints;
pub mod resource_resolution;
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
