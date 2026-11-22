//! Bakes the version the way tsup bakes `__HT_VERSION__`: `package.json` version, plus
//! `-dev+<sha>` unless `HT_RELEASE=1` or `HARNESSTAP_RELEASE=1` (`src/version.ts`).

fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for var in [
        "HT_RELEASE",
        "HARNESSTAP_RELEASE",
        "HT_GIT_SHA",
        "GITHUB_SHA",
    ] {
        println!("cargo:rerun-if-env-changed={var}");
    }
    println!(
        "cargo:rerun-if-changed={}",
        root.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        root.join(".git/HEAD").display()
    );
    let release = version_rs::port::is_release_build(None).unwrap_or(false);
    let sha = version_rs::port::read_git_sha(None, Some(root.display().to_string()))
        .ok()
        .flatten()
        .unwrap_or_default();
    println!("cargo:rustc-env=HT_BUILD_RELEASE={}", u8::from(release));
    println!("cargo:rustc-env=HT_BUILD_GIT_SHA={sha}");
}
