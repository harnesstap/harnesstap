//! JS bindings for `src/services/package-cache/paths.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `packagesCacheRoot`.
#[napi(js_name = "packagesCacheRoot")]
pub fn packages_cache_root(harnesstap_dir: String) -> napi::Result<String> {
    run(move || {
        let out = port::packages_cache_root(harnesstap_dir)?;
        Ok(out)
    })
}

/// `hostPluginPackagesParent`.
#[napi(js_name = "hostPluginPackagesParent")]
pub fn host_plugin_packages_parent(
    harnesstap_dir: String,
    marketplace: String,
    plugin_name: String,
) -> napi::Result<String> {
    run(move || {
        let out = port::host_plugin_packages_parent(harnesstap_dir, marketplace, plugin_name)?;
        Ok(out)
    })
}

/// `hostPluginPackageDir`.
#[napi(js_name = "hostPluginPackageDir")]
pub fn host_plugin_package_dir(
    harnesstap_dir: String,
    marketplace: String,
    plugin_name: String,
    version: String,
) -> napi::Result<String> {
    run(move || {
        let out = port::host_plugin_package_dir(harnesstap_dir, marketplace, plugin_name, version)?;
        Ok(out)
    })
}

/// `hostPluginPackageRelativePath`.
#[napi(js_name = "hostPluginPackageRelativePath")]
pub fn host_plugin_package_relative_path(
    marketplace: String,
    plugin_name: String,
    version: String,
) -> napi::Result<String> {
    run(move || {
        let out = port::host_plugin_package_relative_path(marketplace, plugin_name, version)?;
        Ok(out)
    })
}

/// `apmGitLegacyPackagePaths`.
#[napi(js_name = "apmGitLegacyPackagePaths")]
pub fn apm_git_legacy_package_paths(
    harnesstap_dir: String,
    repo_url: String,
    commit: String,
) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::apm_git_legacy_package_paths(harnesstap_dir, repo_url, commit)?;
        Ok(out)
    })
}

/// `apmGitPackageDir`.
#[napi(js_name = "apmGitPackageDir")]
pub fn apm_git_package_dir(
    harnesstap_dir: String,
    repo_url: String,
    commit: String,
) -> napi::Result<String> {
    run(move || {
        let out = port::apm_git_package_dir(harnesstap_dir, repo_url, commit)?;
        Ok(out)
    })
}

/// `apmGitPackageRelativePath`.
#[napi(js_name = "apmGitPackageRelativePath")]
pub fn apm_git_package_relative_path(repo_url: String, commit: String) -> napi::Result<String> {
    run(move || {
        let out = port::apm_git_package_relative_path(repo_url, commit)?;
        Ok(out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

type WireBuffers = (
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint32Array,
);

thread_local! {
    static WIRE: std::cell::RefCell<Option<WireBuffers>> = const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static SCRATCH: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument, result and argument-length buffers `index.cjs` uses.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
    len: napi::bindgen_prelude::Uint32Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output, len)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output, _)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads the argument bytes (`wLen[0]` of them), runs `f`, and writes its result; a negative
/// return is the size of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output, len)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len.first().copied().unwrap_or(0) as usize).min(input.len());
        let mut w = wire::Writer(SCRATCH.with(|s| std::mem::take(&mut *s.borrow_mut())));
        w.0.clear();
        let result = run(|| f(&mut wire::Reader::new(&input[..len]), &mut w));
        let keep = |w: wire::Writer| SCRATCH.with(|s| *s.borrow_mut() = w.0);
        match result {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => {
                keep(w);
                return Ok(f64::NAN);
            }
            Err(e) => {
                keep(w);
                let mut m = wire::Writer::default();
                m.string16(&e.reason);
                // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
                let out = unsafe { output.as_mut() };
                if m.0.len() > out.len() {
                    return Err(e);
                }
                out[..m.0.len()].copy_from_slice(&m.0);
                return Ok(f64::INFINITY);
            }
            Ok(()) => {}
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        keep(w);
        Ok(n as f64)
    })
}

/// `packagesCacheRoot` over the binary wire.
#[napi(js_name = "packagesCacheRootWire")]
pub fn packages_cache_root_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let harnesstap_dir: String = r.string16()?;
        let out = &port::packages_cache_root(harnesstap_dir)?;
        w.string16(out);
        Ok(())
    })
}

/// `hostPluginPackagesParent` over the binary wire.
#[napi(js_name = "hostPluginPackagesParentWire")]
pub fn host_plugin_packages_parent_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let harnesstap_dir: String = r.string16()?;
        let marketplace: String = r.string16()?;
        let plugin_name: String = r.string16()?;
        let out = &port::host_plugin_packages_parent(harnesstap_dir, marketplace, plugin_name)?;
        w.string16(out);
        Ok(())
    })
}

/// `hostPluginPackageDir` over the binary wire.
#[napi(js_name = "hostPluginPackageDirWire")]
pub fn host_plugin_package_dir_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let harnesstap_dir: String = r.string16()?;
        let marketplace: String = r.string16()?;
        let plugin_name: String = r.string16()?;
        let version: String = r.string16()?;
        let out =
            &port::host_plugin_package_dir(harnesstap_dir, marketplace, plugin_name, version)?;
        w.string16(out);
        Ok(())
    })
}

/// `hostPluginPackageRelativePath` over the binary wire.
#[napi(js_name = "hostPluginPackageRelativePathWire")]
pub fn host_plugin_package_relative_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let marketplace: String = r.string16()?;
        let plugin_name: String = r.string16()?;
        let version: String = r.string16()?;
        let out = &port::host_plugin_package_relative_path(marketplace, plugin_name, version)?;
        w.string16(out);
        Ok(())
    })
}

/// `apmGitLegacyPackagePaths` over the binary wire.
#[napi(js_name = "apmGitLegacyPackagePathsWire")]
pub fn apm_git_legacy_package_paths_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let harnesstap_dir: String = r.string16()?;
        let repo_url: String = r.string16()?;
        let commit: String = r.string16()?;
        let out = &port::apm_git_legacy_package_paths(harnesstap_dir, repo_url, commit)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            w.string16(x0);
        }
        Ok(())
    })
}

/// `apmGitPackageDir` over the binary wire.
#[napi(js_name = "apmGitPackageDirWire")]
pub fn apm_git_package_dir_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let harnesstap_dir: String = r.string16()?;
        let repo_url: String = r.string16()?;
        let commit: String = r.string16()?;
        let out = &port::apm_git_package_dir(harnesstap_dir, repo_url, commit)?;
        w.string16(out);
        Ok(())
    })
}

/// `apmGitPackageRelativePath` over the binary wire.
#[napi(js_name = "apmGitPackageRelativePathWire")]
pub fn apm_git_package_relative_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let repo_url: String = r.string16()?;
        let commit: String = r.string16()?;
        let out = &port::apm_git_package_relative_path(repo_url, commit)?;
        w.string16(out);
        Ok(())
    })
}
