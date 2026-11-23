//! Paths from `src/db/connection.ts`, resolved against an environment.

/// Node's `path.posix.join`: join the non-empty parts, then normalize.
pub fn posix_join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return ".".to_owned();
    }
    posix_normalize(&joined)
}

/// Node's `path.posix.normalize`.
pub fn posix_normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|s| *s != "..") {
                    segments.pop();
                } else if !absolute {
                    segments.push("..");
                }
            }
            s => segments.push(s),
        }
    }
    let mut out = segments.join("/");
    if out.is_empty() && !absolute {
        out.push('.');
    }
    if !out.is_empty() && trailing {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

/// Node's `path.posix.resolve(path)` against `cwd`.
pub fn posix_resolve(cwd: &str, path: &str) -> String {
    let joined = if path.starts_with('/') {
        path.to_owned()
    } else {
        format!("{cwd}/{path}")
    };
    let normalized = posix_normalize(&joined);
    if normalized.len() > 1 {
        normalized.trim_end_matches('/').to_owned()
    } else {
        normalized
    }
}

/// The variables the original reads. `None` is an unset variable.
pub trait Env {
    fn var(&self, name: &str) -> Option<String>;
}

/// The process environment.
pub struct ProcessEnv;

impl Env for ProcessEnv {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}

impl<F: Fn(&str) -> Option<String>> Env for F {
    fn var(&self, name: &str) -> Option<String> {
        self(name)
    }
}

fn harnesstap_home(env: &dyn Env) -> Option<String> {
    env.var("HARNESSTAP_HOME").filter(|v| !v.is_empty())
}

/// `os.homedir()` once `HOME` and `USERPROFILE` are unset: the password database.
#[allow(deprecated)]
fn os_homedir() -> String {
    std::env::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `getHarnesstapDir`: `HARNESSTAP_HOME`, else `~/.harnesstap`.
pub fn harnesstap_dir(env: &dyn Env) -> String {
    if let Some(dir) = harnesstap_home(env) {
        return dir;
    }
    let home = env
        .var("HOME")
        .or_else(|| env.var("USERPROFILE"))
        .unwrap_or_else(os_homedir);
    posix_join(&[&home, ".harnesstap"])
}

/// `harnesstapDirForHomeRoot`.
pub fn harnesstap_dir_for_home_root(env: &dyn Env, home_root: &str) -> String {
    harnesstap_home(env).unwrap_or_else(|| posix_join(&[home_root, ".harnesstap"]))
}

/// `getDbPath`.
pub fn db_path(env: &dyn Env) -> String {
    posix_join(&[&harnesstap_dir(env), "harnesstap.db"])
}

/// `getConfigJsoncPath`.
pub fn config_jsonc_path(env: &dyn Env) -> String {
    posix_join(&[&harnesstap_dir(env), "config.jsonc"])
}

/// `getLegacyConfigPath`.
pub fn legacy_config_path(env: &dyn Env) -> String {
    posix_join(&[&harnesstap_dir(env), "config.json"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_like_node() {
        assert_eq!(
            posix_join(&["a//b/./c/..", ".harnesstap"]),
            "a/b/.harnesstap"
        );
        assert_eq!(posix_join(&["/a/../../b"]), "/b");
        assert_eq!(posix_join(&["../x", ".."]), "..");
        assert_eq!(posix_join(&["", ""]), ".");
        assert_eq!(posix_normalize("./"), "./");
        assert_eq!(posix_normalize("a/"), "a/");
    }
}
