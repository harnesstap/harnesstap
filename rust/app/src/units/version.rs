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

/// The version `PACKAGE_VERSION` holds in a build made from the same commit and environment.
fn package_version() -> Result<String, String> {
    let options = serde_json::json!({
        "isRelease": env!("HT_BUILD_RELEASE") == "1",
        "gitSha": env!("HT_BUILD_GIT_SHA"),
    });
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../../../package.json"))
            .map_err(|e| e.to_string())?;
    let version = manifest["version"].as_str().unwrap_or_default().to_string();
    version_rs::port::format_dev_build_version(version, Some(options))
}

pub fn run(_command: &str, _matches: &ArgMatches) -> ExitCode {
    let argv: Vec<OsString> = std::env::args_os().collect();
    let args = argv.get(1..).unwrap_or_default();
    if !is_root_version_request(args) {
        return crate::original::run(args);
    }
    match package_version() {
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
