//! The port of `src/services/blob-store.ts`.

use db_rs::paths::posix_join;

fn hex_of(content_hash: &str) -> &str {
    content_hash.strip_prefix("sha256:").unwrap_or(content_hash)
}

/// The first two UTF-16 units of `s` (`slice(0, 2)`); hashes are ASCII.
pub(crate) fn first_two(s: &str) -> &str {
    let end = s.char_indices().nth(2).map_or(s.len(), |(i, _)| i);
    &s[..end]
}

/// `blobPath`.
pub fn blob_path(home_root: &str, content_hash: &str) -> String {
    let hex = hex_of(content_hash);
    posix_join(&[home_root, "blobs", "sha256", first_two(hex), hex])
}

/// `writeBlob`: creates the directory, and writes only when the blob is missing.
pub fn write_blob(home_root: &str, content_hash: &str, body: &str) -> std::io::Result<()> {
    let path = blob_path(home_root, content_hash);
    std::fs::create_dir_all(posix_join(&[&path, ".."]))?;
    if !std::path::Path::new(&path).exists() {
        std::fs::write(&path, body)?;
    }
    Ok(())
}

/// `readBlob` (`readFileSync(path, "utf8")`, which replaces invalid UTF-8).
pub fn read_blob(home_root: &str, content_hash: &str) -> std::io::Result<String> {
    let bytes = std::fs::read(blob_path(home_root, content_hash))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
