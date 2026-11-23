//! The port of `src/services/resource-selector.ts`.

use std::cell::RefCell;

/// `ParsedResourceSelector`. `resource_type` is the text before the first
/// `:` (kept even when empty, which callers treat as no type).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedResourceSelector {
    pub resource_type: Option<String>,
    pub name: String,
    pub namespace: String,
}

impl ParsedResourceSelector {
    /// The type when it is set and not empty (JavaScript truthiness).
    pub fn type_filter(&self) -> Option<&str> {
        self.resource_type.as_deref().filter(|t| !t.is_empty())
    }
}

thread_local! {
    static DEPRECATIONS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// `takeSelectorDeprecations`: drain the notices recorded since the last call.
pub fn take_selector_deprecations() -> Vec<String> {
    DEPRECATIONS.with(|d| std::mem::take(&mut *d.borrow_mut()))
}

fn legacy_alias(raw_type: &str) -> Option<&'static str> {
    // The original looks this up on a plain object, so inherited names such
    // as `constructor` also hit; those are not reproduced.
    (raw_type == "plugin_pin").then_some("plugin")
}

/// `parseResourceSelector`.
pub fn parse_resource_selector(selector: &str) -> ParsedResourceSelector {
    let mut resource_type = None;
    let mut name_part = selector;
    if let Some(colon) = selector.find(':') {
        let raw_type = &selector[..colon];
        name_part = &selector[colon + 1..];
        let alias = legacy_alias(raw_type);
        if let Some(alias) = alias {
            DEPRECATIONS.with(|d| {
                d.borrow_mut().push(format!(
                    "{raw_type}: is now {alias}:. Use {alias}:{name_part}"
                ));
            });
        }
        resource_type = Some(alias.unwrap_or(raw_type).to_owned());
    }
    match name_part.rfind('@') {
        Some(at) => ParsedResourceSelector {
            resource_type,
            name: name_part[..at].to_owned(),
            namespace: name_part[at + 1..].to_owned(),
        },
        None => ParsedResourceSelector {
            resource_type,
            name: name_part.to_owned(),
            namespace: String::new(),
        },
    }
}
