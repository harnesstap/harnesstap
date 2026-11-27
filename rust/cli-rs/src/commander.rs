//! commander 13.1.0's parse (`lib/command.js`: `_parseCommand`, `parseOptions`,
//! `_dispatchSubcommand`, `_dispatchHelpCommand`, the argument checks and the error
//! messages, and `lib/suggestSimilar.js`), up to the point where an action would run.

use std::collections::HashSet;

use crate::tree::Node;

/// Where the parse stopped.
#[derive(Debug, PartialEq)]
pub enum Stop {
    /// `this.error(...)`: a `CommanderError` with this message and code (exit code 1).
    Error { message: String, code: &'static str },
    /// `outputHelp` of the command at this path (names from the root), then an exit
    /// the runtime swallows (`commander.help` and `commander.helpDisplayed`).
    Help { path: Vec<String>, to_stderr: bool },
    /// An action handler runs (for a command group, it prints the group's help).
    Action { path: Vec<String>, group_help: bool },
    /// The parse returns without running an action.
    Completed,
    /// Something this port does not reproduce.
    Unsupported,
}

struct Frame<'a> {
    node: &'a Node,
    /// Options given on the command line, by index in `node.options`.
    given: HashSet<usize>,
}

pub fn parse(root: &Node, args: &[String]) -> Stop {
    if root.uses_unported_features() {
        return Stop::Unsupported;
    }
    let mut chain = vec![Frame {
        node: root,
        given: HashSet::new(),
    }];
    parse_command(&mut chain, Vec::new(), args.to_vec())
}

fn path_of(chain: &[Frame<'_>]) -> Vec<String> {
    chain.iter().skip(1).map(|f| f.node.name.clone()).collect()
}

fn error(message: String, code: &'static str) -> Stop {
    Stop::Error { message, code }
}

fn maybe_option(arg: &str) -> bool {
    arg.chars().count() > 1 && arg.starts_with('-')
}

struct Parsed {
    operands: Vec<String>,
    unknown: Vec<String>,
}

/// `parseOptions`, recording which options were given.
fn parse_options(frame: &mut Frame<'_>, argv: Vec<String>) -> Result<Parsed, Stop> {
    let node = frame.node;
    let mut operands = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    let mut to_unknown = false;
    let mut args: std::collections::VecDeque<String> = argv.into();
    let mut active_variadic: Option<usize> = None;

    let emit =
        |given: &mut HashSet<usize>, index: usize, value: Option<&str>| -> Result<(), Stop> {
            let option = &node.options[index];
            if let (Some(value), Some(choices)) = (value, &option.choices)
                && !choices.iter().any(|c| c == value)
            {
                return Err(error(
                    format!(
                        "error: option '{}' argument '{}' is invalid. Allowed choices are {}.",
                        option.flags,
                        value,
                        choices.join(", ")
                    ),
                    "commander.invalidArgument",
                ));
            }
            given.insert(index);
            Ok(())
        };

    while let Some(arg) = args.pop_front() {
        if arg == "--" {
            let dest = if to_unknown {
                &mut unknown
            } else {
                &mut operands
            };
            if to_unknown {
                dest.push(arg);
            }
            dest.extend(args.drain(..));
            break;
        }

        if let Some(index) = active_variadic
            && !maybe_option(&arg)
        {
            emit(&mut frame.given, index, Some(&arg))?;
            continue;
        }
        active_variadic = None;

        if maybe_option(&arg)
            && let Some(index) = node.find_option(&arg)
        {
            let option = &node.options[index];
            if option.required {
                let Some(value) = args.pop_front() else {
                    return Err(error(
                        format!("error: option '{}' argument missing", option.flags),
                        "commander.optionMissingArgument",
                    ));
                };
                emit(&mut frame.given, index, Some(&value))?;
            } else if option.optional {
                let value = match args.front() {
                    Some(next) if !maybe_option(next) => args.pop_front(),
                    _ => None,
                };
                emit(&mut frame.given, index, value.as_deref())?;
            } else {
                emit(&mut frame.given, index, None)?;
            }
            active_variadic = option.variadic.then_some(index);
            continue;
        }

        // Combined short flags (`-abc`, `-ovalue`).
        let mut chars = arg.chars();
        if arg.chars().count() > 2
            && chars.next() == Some('-')
            && let Some(second) = chars.next()
            && second != '-'
            && let Some(index) = node.find_option(&format!("-{second}"))
        {
            let option = &node.options[index];
            let rest: String = chars.collect();
            if option.required || (option.optional && node.combine_flag_and_optional_value) {
                emit(&mut frame.given, index, Some(&rest))?;
            } else {
                emit(&mut frame.given, index, None)?;
                args.push_front(format!("-{rest}"));
            }
            continue;
        }

        // `--flag=value`.
        if let Some(eq) = arg.find('=')
            && arg.starts_with("--")
            && eq > 2
            && let Some(index) = node.find_option(&arg[..eq])
            && (node.options[index].required || node.options[index].optional)
        {
            emit(&mut frame.given, index, Some(&arg[eq + 1..]))?;
            continue;
        }

        if maybe_option(&arg) {
            to_unknown = true;
        }

        if (node.positional_options || node.pass_through)
            && operands.is_empty()
            && unknown.is_empty()
        {
            if node.find_command(&arg).is_some() {
                operands.push(arg);
                unknown.extend(args.drain(..));
                break;
            } else if node.help_command.as_deref() == Some(arg.as_str()) {
                operands.push(arg);
                operands.extend(args.drain(..));
                break;
            }
        }

        let dest = if to_unknown {
            &mut unknown
        } else {
            &mut operands
        };
        if node.pass_through {
            dest.push(arg);
            dest.extend(args.drain(..));
            break;
        }
        dest.push(arg);
    }

    Ok(Parsed { operands, unknown })
}

fn parse_command(chain: &mut Vec<Frame<'_>>, operands: Vec<String>, unknown: Vec<String>) -> Stop {
    let depth = chain.len() - 1;
    let parsed = match parse_options(&mut chain[depth], unknown) {
        Ok(parsed) => parsed,
        Err(stop) => return stop,
    };
    let node = chain[depth].node;
    let mut operands = operands;
    operands.extend(parsed.operands.iter().cloned());
    let unknown = parsed.unknown.clone();
    let args: Vec<String> = operands.iter().chain(unknown.iter()).cloned().collect();

    if let Some(first) = operands.first()
        && let Some(sub) = node.find_command(first)
    {
        chain.push(Frame {
            node: sub,
            given: HashSet::new(),
        });
        return parse_command(chain, operands[1..].to_vec(), unknown);
    }
    if let Some(help) = &node.help_command
        && operands.first() == Some(help)
    {
        return dispatch_help_command(chain, operands.get(1).map(String::as_str));
    }
    if !node.commands.is_empty() && args.is_empty() && !node.has_action {
        return Stop::Help {
            path: path_of(chain),
            to_stderr: true,
        };
    }

    if parsed.unknown.iter().any(|a| node.wants_help(a)) {
        return Stop::Help {
            path: path_of(chain),
            to_stderr: false,
        };
    }
    for frame in chain.iter().rev() {
        for (index, option) in frame.node.options.iter().enumerate() {
            if option.mandatory && !frame.given.contains(&index) {
                return error(
                    format!("error: required option '{}' not specified", option.flags),
                    "commander.missingMandatoryOptionValue",
                );
            }
        }
    }

    let check_unknown = |chain: &[Frame<'_>]| -> Option<Stop> {
        let flag = parsed.unknown.first()?;
        unknown_option(chain, flag)
    };

    if node.has_action {
        if let Some(stop) = check_unknown(chain) {
            return stop;
        }
        if let Some(stop) = check_arguments(chain, &args) {
            return stop;
        }
        return Stop::Action {
            path: path_of(chain),
            group_help: node.group_help_action,
        };
    }
    if !operands.is_empty() {
        if !node.commands.is_empty() {
            return unknown_command(node, &args[0]);
        }
        if let Some(stop) = check_unknown(chain) {
            return stop;
        }
        return check_arguments(chain, &args).unwrap_or(Stop::Completed);
    }
    if let Some(stop) = check_unknown(chain) {
        return stop;
    }
    if !node.commands.is_empty() {
        return Stop::Help {
            path: path_of(chain),
            to_stderr: true,
        };
    }
    check_arguments(chain, &args).unwrap_or(Stop::Completed)
}

/// `_dispatchHelpCommand`.
fn dispatch_help_command(chain: &mut Vec<Frame<'_>>, sub: Option<&str>) -> Stop {
    let node = chain[chain.len() - 1].node;
    let Some(sub) = sub.filter(|s| !s.is_empty()) else {
        return Stop::Help {
            path: path_of(chain),
            to_stderr: false,
        };
    };
    if let Some(found) = node.find_command(sub) {
        let mut path = path_of(chain);
        path.push(found.name.clone());
        return Stop::Help {
            path,
            to_stderr: false,
        };
    }
    // `_dispatchSubcommand` of a name that does not exist: `this.help({ error: true })`.
    Stop::Help {
        path: path_of(chain),
        to_stderr: true,
    }
}

/// `_checkNumberOfArguments` (no argument has a custom parser in the dumped tree).
fn check_arguments(chain: &[Frame<'_>], args: &[String]) -> Option<Stop> {
    let node = chain[chain.len() - 1].node;
    for (index, argument) in node.arguments.iter().enumerate() {
        if argument.required && index >= args.len() {
            return Some(error(
                format!("error: missing required argument '{}'", argument.name),
                "commander.missingArgument",
            ));
        }
    }
    if node.arguments.last().is_some_and(|a| a.variadic) {
        return argument_choices(node, args);
    }
    if args.len() > node.arguments.len() && !node.allow_excess_arguments {
        let expected = node.arguments.len();
        let s = if expected == 1 { "" } else { "s" };
        let for_subcommand = if chain.len() > 1 {
            format!(" for '{}'", node.name)
        } else {
            String::new()
        };
        return Some(error(
            format!(
                "error: too many arguments{for_subcommand}. Expected {expected} argument{s} but got {}.",
                args.len()
            ),
            "commander.excessArguments",
        ));
    }
    argument_choices(node, args)
}

/// `_processArguments` parse of argument choices.
fn argument_choices(node: &Node, args: &[String]) -> Option<Stop> {
    for (index, argument) in node.arguments.iter().enumerate() {
        let Some(choices) = &argument.choices else {
            continue;
        };
        let values: &[String] = if argument.variadic {
            args.get(index..).unwrap_or_default()
        } else {
            args.get(index..=index).unwrap_or_default()
        };
        if let Some(value) = values.iter().find(|v| !choices.contains(v)) {
            return Some(error(
                format!(
                    "error: command-argument value '{value}' is invalid for argument '{}'. Allowed choices are {}.",
                    argument.name,
                    choices.join(", ")
                ),
                "commander.invalidArgument",
            ));
        }
    }
    None
}

fn unknown_option(chain: &[Frame<'_>], flag: &str) -> Option<Stop> {
    let node = chain[chain.len() - 1].node;
    if node.allow_unknown_option {
        return None;
    }
    let mut suggestion = String::new();
    if flag.starts_with("--") {
        // The command itself, then each parent up to one with positional options.
        let mut candidates = node.suggest_options.clone();
        for frame in chain[..chain.len() - 1].iter().rev() {
            if frame.node.positional_options {
                break;
            }
            candidates.extend(frame.node.suggest_options.iter().cloned());
        }
        suggestion = suggest_similar(flag, &candidates);
    }
    Some(error(
        format!("error: unknown option '{flag}'{suggestion}"),
        "commander.unknownOption",
    ))
}

fn unknown_command(node: &Node, name: &str) -> Stop {
    let suggestion = suggest_similar(name, &node.suggest_commands);
    error(
        format!("error: unknown command '{name}'{suggestion}"),
        "commander.unknownCommand",
    )
}

const MAX_DISTANCE: usize = 3;

/// `editDistance` over UTF-16 code units, like the JavaScript.
fn edit_distance(a: &[u16], b: &[u16]) -> usize {
    if a.len().abs_diff(b.len()) > MAX_DISTANCE {
        return a.len().max(b.len());
    }
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for j in 1..=b.len() {
        for i in 1..=a.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            d[i][j] = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[a.len()][b.len()]
}

/// `suggestSimilar`.
pub fn suggest_similar(word: &str, candidates: &[String]) -> String {
    if candidates.is_empty() {
        return String::new();
    }
    let mut unique: Vec<&str> = Vec::new();
    for candidate in candidates {
        if !unique.contains(&candidate.as_str()) {
            unique.push(candidate);
        }
    }
    let searching_options = word.starts_with("--");
    let utf16 = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    let word16 = if searching_options {
        utf16(word)[2..].to_vec()
    } else {
        utf16(word)
    };
    let mut similar: Vec<Vec<u16>> = Vec::new();
    let mut best = MAX_DISTANCE;
    for candidate in unique {
        let mut c16 = utf16(candidate);
        if searching_options {
            c16 = c16.get(2..).unwrap_or_default().to_vec();
        }
        if c16.len() <= 1 {
            continue;
        }
        let distance = edit_distance(&word16, &c16);
        let length = word16.len().max(c16.len()) as f64;
        let similarity = (length - distance as f64) / length;
        if similarity > 0.4 {
            if distance < best {
                best = distance;
                similar = vec![c16];
            } else if distance == best {
                similar.push(c16);
            }
        }
    }
    let mut similar: Vec<String> = similar
        .iter()
        .map(|s| String::from_utf16_lossy(s))
        .collect();
    similar.sort_by(|a, b| collate_rs::locale_compare(a, b));
    if searching_options {
        similar = similar.into_iter().map(|s| format!("--{s}")).collect();
    }
    match similar.len() {
        0 => String::new(),
        1 => format!("\n(Did you mean {}?)", similar[0]),
        _ => format!("\n(Did you mean one of {}?)", similar.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestions_follow_commander() {
        let c = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            suggest_similar("lsit", &c(&["list", "show"])),
            "\n(Did you mean list?)"
        );
        assert_eq!(
            suggest_similar("--serch", &c(&["--search", "--help"])),
            "\n(Did you mean --search?)"
        );
        assert_eq!(suggest_similar("xyz", &c(&["list"])), "");
        assert_eq!(
            suggest_similar("ad", &c(&["add", "a", "ab"])),
            "\n(Did you mean one of ab, add?)"
        );
    }
}
