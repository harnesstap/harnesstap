//! JS bindings for `src/services/harness-scope.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
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

/// `parseHarnessScope`.
#[napi(js_name = "parseHarnessScope")]
pub fn parse_harness_scope(raw: String) -> napi::Result<String> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::parse_harness_scope(raw)?;
        crate::js::to_json(&out)
    })
}

/// `serializeHarnessScope`.
#[napi(js_name = "serializeHarnessScope")]
pub fn serialize_harness_scope(scope: String) -> napi::Result<String> {
    run(move || {
        let scope = crate::js::from_json(&scope)?;
        let out = port::serialize_harness_scope(scope)?;
        Ok(out)
    })
}

/// `harnessScopeWire`.
#[napi(js_name = "harnessScopeWire")]
pub fn harness_scope_wire(scope: String) -> napi::Result<String> {
    run(move || {
        let scope = crate::js::from_json(&scope)?;
        let out = port::harness_scope_wire(scope)?;
        crate::js::to_json(&out)
    })
}

/// `resourceHarnessScope`.
#[napi(js_name = "resourceHarnessScope")]
pub fn resource_harness_scope(resource: String) -> napi::Result<String> {
    run(move || {
        let resource = crate::js::from_json(&resource)?;
        let out = port::resource_harness_scope(resource)?;
        crate::js::to_json(&out)
    })
}

/// `uniqueSorted`.
#[napi(js_name = "uniqueSorted")]
pub fn unique_sorted(ids: Vec<String>) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::unique_sorted(ids)?;
        Ok(out)
    })
}

/// `intersectHarnessScopes`.
#[napi(js_name = "intersectHarnessScopes")]
pub fn intersect_harness_scopes(left: String, right: String) -> napi::Result<String> {
    run(move || {
        let left = crate::js::from_json(&left)?;
        let right = crate::js::from_json(&right)?;
        let out = port::intersect_harness_scopes(left, right)?;
        crate::js::to_json(&out)
    })
}

/// `unionHarnessScopes`.
#[napi(js_name = "unionHarnessScopes")]
pub fn union_harness_scopes(left: String, right: String) -> napi::Result<String> {
    run(move || {
        let left = crate::js::from_json(&left)?;
        let right = crate::js::from_json(&right)?;
        let out = port::union_harness_scopes(left, right)?;
        crate::js::to_json(&out)
    })
}

/// `resourceAppliesToHarness`.
#[napi(js_name = "resourceAppliesToHarness")]
pub fn resource_applies_to_harness(resource: String, harness_id: String) -> napi::Result<bool> {
    run(move || {
        let resource = crate::js::from_json(&resource)?;
        let out = port::resource_applies_to_harness(resource, harness_id)?;
        Ok(out)
    })
}

/// `normalizeScopeToRegistered`.
#[napi(js_name = "normalizeScopeToRegistered")]
pub fn normalize_scope_to_registered(
    scope: String,
    registered: Vec<String>,
) -> napi::Result<String> {
    run(move || {
        let scope = crate::js::from_json(&scope)?;
        let out = port::normalize_scope_to_registered(scope, registered)?;
        crate::js::to_json(&out)
    })
}

/// `coversRegistered`.
#[napi(js_name = "coversRegistered")]
pub fn covers_registered(selected: Vec<String>, registered: Vec<String>) -> napi::Result<bool> {
    run(move || {
        let out = port::covers_registered(selected, registered)?;
        Ok(out)
    })
}

/// `isOrphanedHarnessScope`.
#[napi(js_name = "isOrphanedHarnessScope")]
pub fn is_orphaned_harness_scope(scope: String, registered: Vec<String>) -> napi::Result<bool> {
    run(move || {
        let scope = crate::js::from_json(&scope)?;
        let out = port::is_orphaned_harness_scope(scope, registered)?;
        Ok(out)
    })
}

/// `pathSurfaceForResourceType`.
#[napi(js_name = "pathSurfaceForResourceType")]
pub fn path_surface_for_resource_type(r#type: String) -> napi::Result<String> {
    run(move || {
        let out = port::path_surface_for_resource_type(r#type)?;
        crate::js::to_json(&out)
    })
}

/// `normalizeEmitPath`.
#[napi(js_name = "normalizeEmitPath")]
pub fn normalize_emit_path(
    raw: Option<String>,
) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let out = port::normalize_emit_path(raw)?;
        Ok(out.map_or(
            napi::bindgen_prelude::Either::B(()),
            napi::bindgen_prelude::Either::A,
        ))
    })
}

/// `originHarnessesFromSourcePath`.
#[napi(js_name = "originHarnessesFromSourcePath")]
pub fn origin_harnesses_from_source_path(source: Option<String>) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::origin_harnesses_from_source_path(source)?;
        Ok(out)
    })
}

/// `originHarnessFromSourcePath`.
#[napi(js_name = "originHarnessFromSourcePath")]
pub fn origin_harness_from_source_path(
    source: Option<String>,
) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let out = port::origin_harness_from_source_path(source)?;
        Ok(out.map_or(
            napi::bindgen_prelude::Either::B(()),
            napi::bindgen_prelude::Either::A,
        ))
    })
}

/// `diskCaptureHarnessScope`.
#[napi(js_name = "diskCaptureHarnessScope")]
pub fn disk_capture_harness_scope(resource: String) -> napi::Result<String> {
    run(move || {
        let resource = crate::js::from_json(&resource)?;
        let out = port::disk_capture_harness_scope(resource)?;
        crate::js::to_json(&out)
    })
}

/// `emitPathForResourceType`.
#[napi(js_name = "emitPathForResourceType")]
pub fn emit_path_for_resource_type(
    platform_id: String,
    r#type: String,
    target: String,
) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let out = port::emit_path_for_resource_type(platform_id, r#type, target)?;
        Ok(out.map_or(
            napi::bindgen_prelude::Either::B(()),
            napi::bindgen_prelude::Either::A,
        ))
    })
}

/// `linkedHarnessGroups`.
#[napi(js_name = "linkedHarnessGroups")]
pub fn linked_harness_groups(
    registered: Vec<String>,
    r#type: String,
    target: String,
) -> napi::Result<String> {
    run(move || {
        let out = port::linked_harness_groups(registered, r#type, target)?;
        crate::js::to_json(&out)
    })
}

/// `expandLinkedSelection`.
#[napi(js_name = "expandLinkedSelection")]
pub fn expand_linked_selection(
    selected: Vec<String>,
    toggle_ids: Vec<String>,
    next_checked: bool,
) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::expand_linked_selection(selected, toggle_ids, next_checked)?;
        Ok(out)
    })
}

/// `selectionFromGroups`.
#[napi(js_name = "selectionFromGroups")]
pub fn selection_from_groups(selected: String, group: String) -> napi::Result<bool> {
    run(move || {
        let selected = crate::js::from_json(&selected)?;
        let group = crate::js::from_json(&group)?;
        let out = port::selection_from_groups(selected, group)?;
        Ok(out)
    })
}

/// `withHarnessScope`.
#[napi(js_name = "withHarnessScope")]
pub fn with_harness_scope(resource: String, scope: String) -> napi::Result<String> {
    run(move || {
        let resource = crate::js::from_json(&resource)?;
        let scope = crate::js::from_json(&scope)?;
        let out = port::with_harness_scope(resource, scope)?;
        crate::js::to_json(&out)
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

static S_PARSE_HARNESS_SCOPE_0: wire::Schema = wire::Schema::Dyn;
static S_PARSE_HARNESS_SCOPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `parseHarnessScope` over the binary wire.
#[napi(js_name = "parseHarnessScopeWire")]
pub fn parse_harness_scope_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw: serde_json::Value = wire::read_value(r, &S_PARSE_HARNESS_SCOPE_0)?;
        let out = &port::parse_harness_scope(raw)?;
        wire::write_value(w, out, &S_PARSE_HARNESS_SCOPE_OUT)?;
        Ok(())
    })
}

static S_SERIALIZE_HARNESS_SCOPE_0: wire::Schema = wire::Schema::Dyn;

/// `serializeHarnessScope` over the binary wire.
#[napi(js_name = "serializeHarnessScopeWire")]
pub fn serialize_harness_scope_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: serde_json::Value = wire::read_value(r, &S_SERIALIZE_HARNESS_SCOPE_0)?;
        let out = &port::serialize_harness_scope(scope)?;
        w.string16(out);
        Ok(())
    })
}

static S_HARNESS_SCOPE_WIRE_0: wire::Schema = wire::Schema::Dyn;
static S_HARNESS_SCOPE_WIRE_OUT: wire::Schema = wire::Schema::Dyn;

/// `harnessScopeWire` over the binary wire.
#[napi(js_name = "harnessScopeWireWire")]
pub fn harness_scope_wire_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: serde_json::Value = wire::read_value(r, &S_HARNESS_SCOPE_WIRE_0)?;
        let out = &port::harness_scope_wire(scope)?;
        wire::write_value(w, out, &S_HARNESS_SCOPE_WIRE_OUT)?;
        Ok(())
    })
}

static S_RESOURCE_HARNESS_SCOPE_0: wire::Schema = wire::Schema::Dyn;
static S_RESOURCE_HARNESS_SCOPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `resourceHarnessScope` over the binary wire.
#[napi(js_name = "resourceHarnessScopeWire")]
pub fn resource_harness_scope_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let resource: serde_json::Value = wire::read_value(r, &S_RESOURCE_HARNESS_SCOPE_0)?;
        let out = &port::resource_harness_scope(resource)?;
        wire::write_value(w, out, &S_RESOURCE_HARNESS_SCOPE_OUT)?;
        Ok(())
    })
}

/// `uniqueSorted` over the binary wire.
#[napi(js_name = "uniqueSortedWire")]
pub fn unique_sorted_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let ids: Vec<String> = r.list(|r| r.string16())?;
        let out = &port::unique_sorted(ids)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            w.string16(x0);
        }
        Ok(())
    })
}

static S_INTERSECT_HARNESS_SCOPES_0: wire::Schema = wire::Schema::Dyn;
static S_INTERSECT_HARNESS_SCOPES_1: wire::Schema = wire::Schema::Dyn;
static S_INTERSECT_HARNESS_SCOPES_OUT: wire::Schema = wire::Schema::Dyn;

/// `intersectHarnessScopes` over the binary wire.
#[napi(js_name = "intersectHarnessScopesWire")]
pub fn intersect_harness_scopes_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let left: serde_json::Value = wire::read_value(r, &S_INTERSECT_HARNESS_SCOPES_0)?;
        let right: serde_json::Value = wire::read_value(r, &S_INTERSECT_HARNESS_SCOPES_1)?;
        let out = &port::intersect_harness_scopes(left, right)?;
        wire::write_value(w, out, &S_INTERSECT_HARNESS_SCOPES_OUT)?;
        Ok(())
    })
}

static S_UNION_HARNESS_SCOPES_0: wire::Schema = wire::Schema::Dyn;
static S_UNION_HARNESS_SCOPES_1: wire::Schema = wire::Schema::Dyn;
static S_UNION_HARNESS_SCOPES_OUT: wire::Schema = wire::Schema::Dyn;

/// `unionHarnessScopes` over the binary wire.
#[napi(js_name = "unionHarnessScopesWire")]
pub fn union_harness_scopes_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let left: serde_json::Value = wire::read_value(r, &S_UNION_HARNESS_SCOPES_0)?;
        let right: serde_json::Value = wire::read_value(r, &S_UNION_HARNESS_SCOPES_1)?;
        let out = &port::union_harness_scopes(left, right)?;
        wire::write_value(w, out, &S_UNION_HARNESS_SCOPES_OUT)?;
        Ok(())
    })
}

static S_RESOURCE_APPLIES_TO_HARNESS_0: wire::Schema = wire::Schema::Dyn;

/// `resourceAppliesToHarness` over the binary wire.
#[napi(js_name = "resourceAppliesToHarnessWire")]
pub fn resource_applies_to_harness_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let resource: serde_json::Value = wire::read_value(r, &S_RESOURCE_APPLIES_TO_HARNESS_0)?;
        let harness_id: String = r.string16()?;
        let out = &port::resource_applies_to_harness(resource, harness_id)?;
        w.bool(*out);
        Ok(())
    })
}

static S_NORMALIZE_SCOPE_TO_REGISTERED_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_SCOPE_TO_REGISTERED_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeScopeToRegistered` over the binary wire.
#[napi(js_name = "normalizeScopeToRegisteredWire")]
pub fn normalize_scope_to_registered_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: serde_json::Value = wire::read_value(r, &S_NORMALIZE_SCOPE_TO_REGISTERED_0)?;
        let registered: Vec<String> = r.list(|r| r.string16())?;
        let out = &port::normalize_scope_to_registered(scope, registered)?;
        wire::write_value(w, out, &S_NORMALIZE_SCOPE_TO_REGISTERED_OUT)?;
        Ok(())
    })
}

/// `coversRegistered` over the binary wire.
#[napi(js_name = "coversRegisteredWire")]
pub fn covers_registered_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let selected: Vec<String> = r.list(|r| r.string16())?;
        let registered: Vec<String> = r.list(|r| r.string16())?;
        let out = &port::covers_registered(selected, registered)?;
        w.bool(*out);
        Ok(())
    })
}

static S_IS_ORPHANED_HARNESS_SCOPE_0: wire::Schema = wire::Schema::Dyn;

/// `isOrphanedHarnessScope` over the binary wire.
#[napi(js_name = "isOrphanedHarnessScopeWire")]
pub fn is_orphaned_harness_scope_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: serde_json::Value = wire::read_value(r, &S_IS_ORPHANED_HARNESS_SCOPE_0)?;
        let registered: Vec<String> = r.list(|r| r.string16())?;
        let out = &port::is_orphaned_harness_scope(scope, registered)?;
        w.bool(*out);
        Ok(())
    })
}

/// `pathSurfaceForResourceType` over the binary wire.
#[napi(js_name = "pathSurfaceForResourceTypeWire")]
pub fn path_surface_for_resource_type_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let r#type: String = r.string16()?;
        let out = &port::path_surface_for_resource_type(r#type)?;
        wire::write_dyn(w, &serde_json::to_value(out).map_err(|e| e.to_string())?);
        Ok(())
    })
}

/// `normalizeEmitPath` over the binary wire.
#[napi(js_name = "normalizeEmitPathWire")]
pub fn normalize_emit_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::normalize_emit_path(raw)?;
        match out {
            Some(x0) => {
                w.tag(1);
                w.string16(x0);
            }
            None => w.tag(0),
        }
        Ok(())
    })
}

/// `originHarnessesFromSourcePath` over the binary wire.
#[napi(js_name = "originHarnessesFromSourcePathWire")]
pub fn origin_harnesses_from_source_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let source: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::origin_harnesses_from_source_path(source)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            w.string16(x0);
        }
        Ok(())
    })
}

/// `originHarnessFromSourcePath` over the binary wire.
#[napi(js_name = "originHarnessFromSourcePathWire")]
pub fn origin_harness_from_source_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let source: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::origin_harness_from_source_path(source)?;
        match out {
            Some(x0) => {
                w.tag(1);
                w.string16(x0);
            }
            None => w.tag(0),
        }
        Ok(())
    })
}

static S_DISK_CAPTURE_HARNESS_SCOPE_0: wire::Schema = wire::Schema::Dyn;
static S_DISK_CAPTURE_HARNESS_SCOPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `diskCaptureHarnessScope` over the binary wire.
#[napi(js_name = "diskCaptureHarnessScopeWire")]
pub fn disk_capture_harness_scope_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let resource: serde_json::Value = wire::read_value(r, &S_DISK_CAPTURE_HARNESS_SCOPE_0)?;
        let out = &port::disk_capture_harness_scope(resource)?;
        wire::write_value(w, out, &S_DISK_CAPTURE_HARNESS_SCOPE_OUT)?;
        Ok(())
    })
}

/// `emitPathForResourceType` over the binary wire.
#[napi(js_name = "emitPathForResourceTypeWire")]
pub fn emit_path_for_resource_type_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let platform_id: String = r.string16()?;
        let r#type: String = r.string16()?;
        let target: String = r.string16()?;
        let out = &port::emit_path_for_resource_type(platform_id, r#type, target)?;
        match out {
            Some(x0) => {
                w.tag(1);
                w.string16(x0);
            }
            None => w.tag(0),
        }
        Ok(())
    })
}

static S_LINKED_HARNESS_GROUPS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("key", wire::Schema::Str16),
    ("harnessIds", wire::Schema::List(&wire::Schema::Str16)),
    ("linked", wire::Schema::Bool),
    ("emitPath", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `linkedHarnessGroups` over the binary wire.
#[napi(js_name = "linkedHarnessGroupsWire")]
pub fn linked_harness_groups_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let registered: Vec<String> = r.list(|r| r.string16())?;
        let r#type: String = r.string16()?;
        let target: String = r.string16()?;
        let out = &port::linked_harness_groups(registered, r#type, target)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_LINKED_HARNESS_GROUPS_OUT.inner())?;
        }
        Ok(())
    })
}

/// `expandLinkedSelection` over the binary wire.
#[napi(js_name = "expandLinkedSelectionWire")]
pub fn expand_linked_selection_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let selected: Vec<String> = r.list(|r| r.string16())?;
        let toggle_ids: Vec<String> = r.list(|r| r.string16())?;
        let next_checked: bool = r.bool()?;
        let out = &port::expand_linked_selection(selected, toggle_ids, next_checked)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            w.string16(x0);
        }
        Ok(())
    })
}

static S_SELECTION_FROM_GROUPS_0: wire::Schema = wire::Schema::Dyn;
static S_SELECTION_FROM_GROUPS_1: wire::Schema = wire::Schema::Dyn;

/// `selectionFromGroups` over the binary wire.
#[napi(js_name = "selectionFromGroupsWire")]
pub fn selection_from_groups_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let selected: serde_json::Value = wire::read_value(r, &S_SELECTION_FROM_GROUPS_0)?;
        let group: serde_json::Value = wire::read_value(r, &S_SELECTION_FROM_GROUPS_1)?;
        let out = &port::selection_from_groups(selected, group)?;
        w.bool(*out);
        Ok(())
    })
}

static S_WITH_HARNESS_SCOPE_0: wire::Schema = wire::Schema::Dyn;
static S_WITH_HARNESS_SCOPE_1: wire::Schema = wire::Schema::Dyn;
static S_WITH_HARNESS_SCOPE_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Str16),
    ("type", wire::Schema::Dyn),
    ("name", wire::Schema::Str16),
    ("description", wire::Schema::Str16),
    ("content", wire::Schema::Str16),
    ("metadata", wire::Schema::Dyn),
    ("source", wire::Schema::Str16),
    ("namespace", wire::Schema::Str16),
    ("origin_kind", wire::Schema::Dyn),
    ("origin_ref", wire::Schema::Str16),
    ("content_hash", wire::Schema::Str16),
    ("content_blob_ref", wire::Schema::Str16),
    ("created_at", wire::Schema::Str16),
    ("updated_at", wire::Schema::Str16),
    ("harness_scope", wire::Schema::Dyn),
]);

/// `withHarnessScope` over the binary wire.
#[napi(js_name = "withHarnessScopeWire")]
pub fn with_harness_scope_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let resource: serde_json::Value = wire::read_value(r, &S_WITH_HARNESS_SCOPE_0)?;
        let scope: serde_json::Value = wire::read_value(r, &S_WITH_HARNESS_SCOPE_1)?;
        let out = &port::with_harness_scope(resource, scope)?;
        wire::write_value(w, out, &S_WITH_HARNESS_SCOPE_OUT)?;
        Ok(())
    })
}
