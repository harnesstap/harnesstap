//! The CLI front end of `ht`: what `src/bin.ts` and `runHarnesstapCli` (`src/cli/runtime.ts`)
//! do before an action runs, with commander 13's parse over the original's command tree
//! (`data/tree.json`, dumped by `tests/dump-tree.ts`). It answers root help, the
//! `uninstall` and `version` guards, `--help` on any command, a command group's own help
//! and every commander error; for anything else (an action, colored help, telemetry that is
//! not switched off, `--verbose` errors) it says so and the original runs.

pub mod actions;
pub mod commander;
pub mod tree;

use commander::Stop;
use tree::{Node, tree};

/// `GLOBAL_DEFAULT_PROFILE_NAME` and `LEGACY_DEFAULT_PROFILE_NAME` (`src/constants/profile.ts`).
const GLOBAL_DEFAULT_PROFILE_NAME: &str = "global default";
const LEGACY_DEFAULT_PROFILE_NAME: &str = "default";

/// What the profile shorthand (`rewriteProfileShorthandArgv`) finds in the database.
pub enum ProfileNames {
    Names(Vec<String>),
    /// Opening the database or reading the profiles threw: the original keeps argv.
    Failed,
    /// The host cannot tell: the original has to run.
    Unknown,
}

pub trait Host {
    fn var(&self, name: &str) -> Option<String>;
    fn stdout_is_tty(&self) -> bool;
    fn stderr_is_tty(&self) -> bool;
    /// Opens the database (creating and migrating it like `getDb` + `initializeSchema`) and
    /// lists the profile plugin names (`listProfilePluginsCommand`).
    fn profile_names(&mut self) -> ProfileNames;
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// Run the original with the same argv.
    Original,
    Answer {
        stdout: String,
        stderr: String,
        code: u8,
    },
    /// An action ran: print this, then do what `runHarnesstapCli` does after a parse that
    /// returned (`maybeNotifyCliUpdate` with this exit code).
    Acted {
        stdout: String,
        stderr: String,
        code: u8,
    },
}

fn answer_out(stdout: String) -> Outcome {
    Outcome::Answer {
        stdout,
        stderr: String::new(),
        code: 0,
    }
}

/// JavaScript's `\s` and `String.prototype.trim` set.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `ensureErrorPrefix` (`src/copy/cli.ts`).
pub fn ensure_error_prefix(message: &str) -> String {
    let mut rest = message;
    if rest.len() >= 6 && rest[..6].eq_ignore_ascii_case("error:") {
        rest = rest[6..].trim_start_matches(is_js_space);
    }
    let stripped = rest.trim_matches(is_js_space);
    if stripped.is_empty() {
        return "Error: Something went wrong.".to_string();
    }
    if stripped.ends_with(['.', '!', '?']) {
        format!("Error: {stripped}")
    } else {
        format!("Error: {stripped}.")
    }
}

/// `fail(message, { hint })` (`src/cli/shared.ts`) with exit code 1.
fn fail(message: &str, hint: &str) -> Outcome {
    let error = ensure_error_prefix(message);
    let mut stderr = format!("{error}\n");
    if !hint.trim_matches(is_js_space).is_empty() && ensure_error_prefix(hint) != error {
        stderr.push_str(hint);
        stderr.push('\n');
    }
    Outcome::Answer {
        stdout: String::new(),
        stderr,
        code: 1,
    }
}

const ROOT_VERSION_FLAGS: &[&str] = &["-V", "--version", "--harnesstap-version"];
const ROOT_PASSTHROUGH_FLAGS: &[&str] = &["-v", "--verbose", "--no-color", "--no-interactive"];

/// `isRootVersionRequest` (`src/cli/root-flags.ts`).
pub fn is_root_version_request(args: &[String]) -> bool {
    let mut saw = false;
    for arg in args {
        if arg == "--" {
            return false;
        }
        if ROOT_VERSION_FLAGS.contains(&arg.as_str()) {
            saw = true;
        } else if !arg.starts_with('-') {
            return false;
        }
    }
    saw
}

/// `isRootHelpRequest` (`src/cli/root-flags.ts`).
pub fn is_root_help_request(args: &[String]) -> bool {
    if args.is_empty() {
        return true;
    }
    let mut saw = false;
    for arg in args {
        if arg == "--" {
            return false;
        }
        if arg == "-h" || arg == "--help" {
            saw = true;
        } else if !ROOT_PASSTHROUGH_FLAGS.contains(&arg.as_str()) && !arg.starts_with('-') {
            return false;
        }
    }
    saw
}

/// `positionalArgvTokens` (`src/cli/root-flags.ts`).
fn positional_tokens(args: &[String]) -> Vec<&str> {
    let mut tokens = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        if arg.is_empty() {
            continue;
        }
        if arg == "--" {
            tokens.extend(args[i + 1..].iter().map(String::as_str));
            break;
        }
        if !arg.starts_with('-') {
            tokens.push(arg.as_str());
        }
    }
    tokens
}

/// `firstPositionalIndex` (`src/cli/runtime.ts`), over argv without node and the script.
fn first_positional_index(args: &[String]) -> Option<usize> {
    for (i, token) in args.iter().enumerate() {
        if token == "--" {
            return (i + 1 < args.len()).then_some(i + 1);
        }
        if token.is_empty() || !token.starts_with('-') {
            return Some(i);
        }
    }
    None
}

fn env_truthy(host: &dyn Host, name: &str) -> bool {
    host.var(name).is_some_and(|v| !v.is_empty())
}

/// `telemetryEnvFlag()` is `false`: no notice, no startup event.
fn telemetry_off(host: &dyn Host) -> bool {
    host.var("HARNESSTAP_TELEMETRY")
        .map(|v| v.trim_matches(is_js_space).to_lowercase())
        .is_some_and(|v| matches!(v.as_str(), "0" | "false" | "no" | "off"))
}

/// Root help is plain text: `theme` styles only when `NO_COLOR` is unset and chalk's
/// `supports-color` level is above 0. `None` when it could be colored.
fn root_help_is_plain(host: &dyn Host, args: &[String]) -> bool {
    if env_truthy(host, "NO_COLOR") || args.iter().any(|a| a == "--no-color") {
        return true;
    }
    let forced = host.var("FORCE_COLOR");
    if matches!(forced.as_deref(), Some("0" | "false")) {
        return true;
    }
    let color_flag = args
        .iter()
        .any(|a| a == "--color" || a == "--colors" || a.starts_with("--color="));
    forced.is_none()
        && !color_flag
        && (!host.stdout_is_tty() || host.var("TERM").as_deref() == Some("dumb"))
}

/// commander's help is plain when `useColor()` is false, or undefined on a non-TTY stream.
fn commander_help_is_plain(host: &dyn Host, tty: bool) -> bool {
    if env_truthy(host, "NO_COLOR")
        || matches!(host.var("FORCE_COLOR").as_deref(), Some("0" | "false"))
    {
        return true;
    }
    if env_truthy(host, "FORCE_COLOR") || host.var("CLICOLOR_FORCE").is_some() {
        return false;
    }
    !tty
}

/// `resolveInvocationName`: `ht` when launched as `ht`, else `harnesstap`.
pub fn invocation_name(program: &str) -> &'static str {
    let base = program.rsplit(['/', '\\']).next().unwrap_or(program);
    if base == "ht" { "ht" } else { "harnesstap" }
}

fn render_root_help(name: &str, version: &str) -> String {
    tree()
        .root_help
        .replacen("{name} v{version}", &format!("{name} v{version}"), 1)
        .replacen(
            "  {name} [options] [command]",
            &format!("  {name} [options] [command]"),
            1,
        )
}

fn node_at<'a>(root: &'a Node, path: &[String]) -> Option<&'a Node> {
    let mut node = root;
    for name in path {
        node = node.commands.iter().find(|c| &c.name == name)?;
    }
    Some(node)
}

/// `findContextCommand` + `commandPath` (`src/cli/runtime.ts`), over the argv the user typed.
fn context_command_path(root: &Node, args: &[String]) -> String {
    let mut node = root;
    let mut names = Vec::new();
    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        match node.find_command(arg) {
            Some(sub) => {
                names.push(sub.name.as_str());
                node = sub;
            }
            None => break,
        }
    }
    names.join(" ")
}

/// `isGroupedCommandFallbackError` and the rewrite to an unknown command in `runHarnesstapCli`.
fn grouped_fallback(message: &str, args: &[String]) -> Option<String> {
    const GROUPS: &[&str] = &[
        "plugin",
        "resource",
        "auth",
        "migrate",
        "harness",
        "environment",
        "profile",
    ];
    let lower = message.to_lowercase();
    let start = lower.find("too many arguments for '")? + "too many arguments for '".len();
    let name_len = message[start..].find('\'')?;
    let name = &message[start..start + name_len];
    if !GROUPS.iter().any(|g| g.eq_ignore_ascii_case(name)) {
        return None;
    }
    // The second regex wants `'. Expected 0 arguments but got <n>.`; without it the name is "command".
    let tail = &message[start + name_len..];
    let zero = tail
        .strip_prefix("'. Expected 0 arguments but got ")
        .and_then(|t| t.strip_suffix('.'))
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    let name = if zero { name } else { "command" };
    let attempted = args
        .iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .filter(|a| !a.is_empty());
    Some(match attempted {
        Some(sub) => format!("error: unknown command '{name} {sub}'"),
        None => format!("error: unknown command '{name}'"),
    })
}

/// Runs the front end over `args` (argv without the program). `program` is argv\[0\],
/// `version` the baked `PACKAGE_VERSION`.
pub fn run(host: &mut dyn Host, program: &str, args: &[String], version: &str) -> Outcome {
    // src/bin.ts
    if is_root_version_request(args) {
        return Outcome::Original;
    }
    if is_root_help_request(args) {
        if !root_help_is_plain(host, args) {
            return Outcome::Original;
        }
        return answer_out(render_root_help(invocation_name(program), version));
    }

    // runHarnesstapCli
    let positional = args.iter().find(|t| *t != "--" && !t.starts_with('-'));
    match positional.map(String::as_str) {
        Some("uninstall") => {
            return fail(
                "HarnessTap has no uninstall command.",
                "Remove the CLI with: npm uninstall -g harnesstap",
            );
        }
        Some("version") => {
            return fail(
                "HarnessTap has no version command.",
                "Print the version with: ht --version",
            );
        }
        _ => {}
    }
    if !telemetry_off(host) {
        return Outcome::Original;
    }

    let data = tree();
    // rewriteProfileShorthandArgv
    if let Some(index) = first_positional_index(args) {
        let candidate = &args[index];
        if !candidate.is_empty() && !data.top_level_tokens.iter().any(|t| t == candidate) {
            match host.profile_names() {
                ProfileNames::Unknown => return Outcome::Original,
                ProfileNames::Failed => {}
                ProfileNames::Names(names) => {
                    let has = |n: &str| names.iter().any(|x| x == n);
                    let legacy = candidate == LEGACY_DEFAULT_PROFILE_NAME
                        && has(GLOBAL_DEFAULT_PROFILE_NAME);
                    if has(candidate) || legacy {
                        // `profile use <candidate>`: an action.
                        return Outcome::Original;
                    }
                }
            }
        }
    }

    // ensureCommandsForArgv
    let positionals = positional_tokens(args);
    let first = positionals.first().copied();
    if first == Some("__complete")
        || (first == Some("init") && positionals.get(1) == Some(&"completion"))
    {
        return Outcome::Original;
    }
    let root = data.root_with(first.and_then(|f| data.catalog_loader(f)));

    match commander::parse(&root, args) {
        Stop::Unsupported | Stop::Completed => Outcome::Original,
        Stop::Action {
            call,
            group_help: false,
        } => {
            if args.iter().any(|a| a == "-v" || a == "--verbose") {
                return Outcome::Original;
            }
            let Some(printed) = actions::run(&call) else {
                return Outcome::Original;
            };
            if printed.themed && !root_help_is_plain(host, args) {
                return Outcome::Original;
            }
            Outcome::Acted {
                stdout: printed.stdout,
                stderr: printed.stderr,
                code: printed.code,
            }
        }
        Stop::Action {
            call,
            group_help: true,
        } => {
            if !commander_help_is_plain(host, host.stdout_is_tty()) {
                return Outcome::Original;
            }
            node_at(&root, &call.path).map_or(Outcome::Original, |n| Outcome::Acted {
                stdout: n.help.clone(),
                stderr: String::new(),
                code: 0,
            })
        }
        Stop::Help { path, to_stderr } => {
            let tty = if to_stderr {
                host.stderr_is_tty()
            } else {
                host.stdout_is_tty()
            };
            if !commander_help_is_plain(host, tty) {
                return Outcome::Original;
            }
            let Some(node) = node_at(&root, &path) else {
                return Outcome::Original;
            };
            if to_stderr {
                Outcome::Answer {
                    stdout: String::new(),
                    stderr: node.help.clone(),
                    code: 0,
                }
            } else {
                answer_out(node.help.clone())
            }
        }
        Stop::Error { message, code } => {
            if args.iter().any(|a| a == "-v" || a == "--verbose") {
                // renderCliError prints the CommanderError stack.
                return Outcome::Original;
            }
            let message = if code == "commander.excessArguments" {
                grouped_fallback(&message, args).unwrap_or(message)
            } else {
                message
            };
            let path = context_command_path(&root, args);
            let hint = if path.is_empty() {
                "Run ht --help to see the options.".to_string()
            } else {
                format!("Run ht {path} --help to see the options.")
            };
            fail(&message, &hint)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_prefix_matches_copy() {
        assert_eq!(
            ensure_error_prefix("error: unknown option '--x'"),
            "Error: unknown option '--x'."
        );
        assert_eq!(ensure_error_prefix("ERROR:   done!"), "Error: done!");
        assert_eq!(
            ensure_error_prefix("error:  "),
            "Error: Something went wrong."
        );
        assert_eq!(
            ensure_error_prefix("a\n(Did you mean b?)"),
            "Error: a\n(Did you mean b?)."
        );
    }

    #[test]
    fn grouped_fallback_names_the_attempted_subcommand() {
        let args: Vec<String> = ["resource", "日本語"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            grouped_fallback(
                "error: too many arguments for 'resource'. Expected 0 arguments but got 1.",
                &args
            ),
            Some("error: unknown command 'resource 日本語'".to_string())
        );
        assert_eq!(
            grouped_fallback(
                "error: too many arguments for 'lock'. Expected 0 arguments but got 1.",
                &args
            ),
            None
        );
    }
}
