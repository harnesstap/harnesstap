//! Glue from the front door to `version-rs`: `ht --version` (`-V`, `--harnesstap-version`)
//! prints the baked version, as `src/bin.ts` does before loading the CLI. Any other argv
//! without a command goes back to the original.

use std::ffi::OsString;
use std::process::ExitCode;

use clap::ArgMatches;

const VERSION_FLAGS: &[&str] = &["-V", "--version", "--harnesstap-version"];
const PASSTHROUGH_FLAGS: &[&str] = &["-v", "--verbose", "--no-color", "--no-interactive"];

/// Port of `isRootVersionRequest` (`src/cli/root-flags.ts`) over argv without the program.
fn is_root_version_request(args: &[OsString]) -> bool {
    let mut saw_version = false;
    for arg in args {
        let arg = arg.to_string_lossy();
        if arg == "--" {
            return false;
        }
        if VERSION_FLAGS.contains(&arg.as_ref()) {
            saw_version = true;
        } else if PASSTHROUGH_FLAGS.contains(&arg.as_ref()) || arg.starts_with('-') {
            continue;
        } else {
            return false;
        }
    }
    saw_version
}

pub fn run(_command: &str, _matches: &ArgMatches) -> ExitCode {
    let argv: Vec<OsString> = std::env::args_os().collect();
    let args = argv.get(1..).unwrap_or_default();
    if !is_root_version_request(args) {
        return crate::original::run(args);
    }
    match crate::front_end::package_version() {
        Ok(version) => {
            println!("{version}");
            ExitCode::SUCCESS
        }
        Err(_) => crate::original::run(args),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn version_requests_match_root_flags() {
        assert!(is_root_version_request(&args(&["--version"])));
        assert!(is_root_version_request(&args(&[
            "--no-color",
            "-V",
            "--whatever"
        ])));
        assert!(!is_root_version_request(&args(&["-V", "apply"])));
        assert!(!is_root_version_request(&args(&["--", "-V"])));
        assert!(!is_root_version_request(&args(&[])));
    }
}
