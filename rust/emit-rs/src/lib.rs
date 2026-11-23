//! Emitters that reproduce the original's output byte for byte.
//!
//! - [`json::stringify`] matches `JSON.stringify(value, null, indent)`.
//! - [`yaml::stringify`] matches `stringify(value, { indent: 2, lineWidth: 0,
//!   defaultKeyType: "PLAIN" })` from the `yaml` package (2.8), the call every
//!   YAML writer in `src/` uses (ADR-008, ADR-010).
//!
//! Both take a `serde_json::Value` built with `preserve_order`, and both order
//! object keys the way JavaScript does: array-index keys first, ascending, then
//! the others in insertion order.

pub mod js;
pub mod json;
pub mod yaml;
