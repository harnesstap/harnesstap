//! The Rust port of `src/node-version.ts`.

#![forbid(unsafe_code)]

use serde_json::Value;

pub const MIN_SUPPORTED_NODE_MAJOR: f64 = 22.0;
pub const MIN_SUPPORTED_NODE_MINOR: f64 = 12.0;

/// Characters JavaScript's `parseInt` skips before the number: WhiteSpace and LineTerminator.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// `Number.parseInt(part, 10) || 0`: leading digits after optional space and sign, else 0.
fn parse_int_or_zero(part: &str) -> f64 {
    let rest = part.trim_start_matches(is_js_space);
    let (negative, rest) = match rest.as_bytes().first() {
        Some(b'-') => (true, &rest[1..]),
        Some(b'+') => (false, &rest[1..]),
        _ => (false, rest),
    };
    let digits: &str = &rest[..rest.bytes().take_while(u8::is_ascii_digit).count()];
    if digits.is_empty() {
        return 0.0;
    }
    let value: f64 = digits.parse().unwrap_or(0.0);
    // `-0 || 0` is 0.
    if value == 0.0 {
        return 0.0;
    }
    if negative { -value } else { value }
}

fn parse(raw: &str) -> (f64, f64) {
    let mut parts = raw.split('.');
    let major = parts.next().unwrap_or("0");
    let minor = parts.next().unwrap_or("0");
    (parse_int_or_zero(major), parse_int_or_zero(minor))
}

fn string_field<'a>(object: Option<&'a Value>, name: &str) -> Result<Option<&'a str>, String> {
    match object.and_then(|o| o.get(name)) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(other) => Err(format!("TypeError: {name} is not a string: {other}")),
    }
}

/// Port of `parseNodeVersion` (`src/node-version.ts:4`).
pub fn parse_node_version(raw: String) -> Result<Value, String> {
    let (major, minor) = parse(&raw);
    let mut out = serde_json::Map::new();
    out.insert("major".into(), crate::js::number(major));
    out.insert("minor".into(), crate::js::number(minor));
    Ok(Value::Object(out))
}

/// Port of `isSupportedNodeVersion` (`src/node-version.ts:12`).
pub fn is_supported_node_version(raw: String) -> Result<bool, String> {
    let (major, minor) = parse(&raw);
    Ok(major > MIN_SUPPORTED_NODE_MAJOR
        || (major == MIN_SUPPORTED_NODE_MAJOR && minor >= MIN_SUPPORTED_NODE_MINOR))
}

/// Port of `launchedByBun` (`src/node-version.ts:24`).
pub fn launched_by_bun(env: Option<Value>) -> Result<bool, String> {
    let agent = match env.as_ref() {
        None => std::env::var("npm_config_user_agent").ok(),
        Some(env) => string_field(Some(env), "npm_config_user_agent")?.map(str::to_string),
    };
    Ok(agent.unwrap_or_default().starts_with("bun/"))
}

/// Port of `nodeVersionRefusalMessage` (`src/node-version.ts:28`).
pub fn node_version_refusal_message(raw: String, env: Option<Value>) -> Result<String, String> {
    let bun_hint = if launched_by_bun(env)? {
        " Or run it on Bun: bun x --bun harnesstap@latest"
    } else {
        ""
    };
    Ok(format!(
        "HarnessTap needs Node.js {MIN_SUPPORTED_NODE_MAJOR}.{MIN_SUPPORTED_NODE_MINOR} or newer. \
         You have v{raw}. Install Node 22 or 24 from https://nodejs.org.{bun_hint}"
    ))
}

/// Port of `isBunRuntime` (`src/node-version.ts:41`).
pub fn is_bun_runtime(versions: Option<Value>) -> Result<bool, String> {
    Ok(string_field(versions.as_ref(), "bun")?.is_some_and(|bun| !bun.is_empty()))
}

/// Port of `assertSupportedRuntime` (`src/node-version.ts:47`): prints the refusal and exits 1.
pub fn assert_supported_runtime(versions: Option<Value>) -> Result<(), String> {
    if is_bun_runtime(versions.clone())? {
        return Ok(());
    }
    let node = string_field(versions.as_ref(), "node")?.ok_or_else(|| {
        "TypeError: Cannot read properties of undefined (reading 'split')".to_string()
    })?;
    if is_supported_node_version(node.to_string())? {
        return Ok(());
    }
    eprintln!("{}", node_version_refusal_message(node.to_string(), None)?);
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_parse_int() {
        assert_eq!(parse(" 22.012.0"), (22.0, 12.0));
        assert_eq!(parse("v22.12.0"), (0.0, 12.0));
        assert_eq!(parse("-0.5"), (0.0, 5.0));
        assert_eq!(parse("1e3.2"), (1.0, 2.0));
        assert_eq!(parse(""), (0.0, 0.0));
    }

    #[test]
    fn supports_22_12_and_newer() {
        assert_eq!(is_supported_node_version("22.12.0".into()), Ok(true));
        assert_eq!(is_supported_node_version("22.11.9".into()), Ok(false));
        assert_eq!(is_supported_node_version("23.0.0".into()), Ok(true));
    }
}
