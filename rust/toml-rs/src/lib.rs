//! JS bindings for `src/services/toml/`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;

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

/// `environmentsToTomlRecord`.
#[napi(js_name = "environmentsToTomlRecord")]
pub fn environments_to_toml_record(environments: String) -> napi::Result<String> {
    run(move || {
        let environments = crate::js::from_json(&environments)?;
        let out = port::environments_to_toml_record(environments)?;
        crate::js::to_json(&out)
    })
}

/// `environmentsFromTomlRecord`.
#[napi(js_name = "environmentsFromTomlRecord")]
pub fn environments_from_toml_record(record: String) -> napi::Result<String> {
    run(move || {
        let record = crate::js::from_json(&record)?;
        let out = port::environments_from_toml_record(record)?;
        crate::js::to_json(&out)
    })
}

/// `environmentToTomlDocument`.
#[napi(js_name = "environmentToTomlDocument")]
pub fn environment_to_toml_document(environment: String) -> napi::Result<String> {
    run(move || {
        let environment = crate::js::from_json(&environment)?;
        let out = port::environment_to_toml_document(environment)?;
        crate::js::to_json(&out)
    })
}

/// `readTransportFile`.
#[napi(js_name = "readTransportFile")]
pub fn read_transport_file(file_path: String) -> napi::Result<String> {
    run(move || {
        let out = port::read_transport_file(file_path)?;
        Ok(out)
    })
}

/// `sortStringRecord`.
#[napi(js_name = "sortStringRecord")]
pub fn sort_string_record(record: String) -> napi::Result<String> {
    run(move || {
        let record = crate::js::from_json(&record)?;
        let out = port::sort_string_record(record)?;
        crate::js::to_json(&out)
    })
}

/// `assertTomlExtension`.
#[napi(js_name = "assertTomlExtension")]
pub fn assert_toml_extension(file_path: String) -> napi::Result<()> {
    run(move || {
        port::assert_toml_extension(file_path)?;
        Ok(())
    })
}

/// `readSchemaHeader`.
#[napi(js_name = "readSchemaHeader")]
pub fn read_schema_header(document: String) -> napi::Result<String> {
    run(move || {
        let document = crate::js::from_json(&document)?;
        let out = port::read_schema_header(document)?;
        crate::js::to_json(&out)
    })
}

/// `formatTransportToml`.
#[napi(js_name = "formatTransportToml")]
pub fn format_transport_toml(document: String) -> napi::Result<String> {
    run(move || {
        let document = crate::js::from_json(&document)?;
        let out = port::format_transport_toml(document)?;
        Ok(out)
    })
}

/// `writeTransportToml`.
#[napi(js_name = "writeTransportToml")]
pub fn write_transport_toml(file_path: String, document: String) -> napi::Result<()> {
    run(move || {
        let document = crate::js::from_json(&document)?;
        port::write_transport_toml(file_path, document)?;
        Ok(())
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

static S_ENVIRONMENTS_TO_TOML_RECORD_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("name", wire::Schema::Str16),
    ("values", wire::Schema::Map16(&wire::Schema::Str16)),
    (
        "secret_refs",
        wire::Schema::OptJs(&wire::Schema::Map16(&wire::Schema::Obj(&[
            ("provider", wire::Schema::Dyn),
            ("ref", wire::Schema::Dyn),
        ]))),
    ),
]));
static S_ENVIRONMENTS_TO_TOML_RECORD_OUT: wire::Schema =
    wire::Schema::Map16(&wire::Schema::Map16(&wire::Schema::Dyn));

/// `environmentsToTomlRecord` over the binary wire.
#[napi(js_name = "environmentsToTomlRecordWire")]
pub fn environments_to_toml_record_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let environments: Vec<serde_json::Value> =
            r.list(|r| wire::read_value(r, S_ENVIRONMENTS_TO_TOML_RECORD_0.inner()))?;
        let out = &port::environments_to_toml_record(environments)?;
        wire::write_value(w, out, &S_ENVIRONMENTS_TO_TOML_RECORD_OUT)?;
        Ok(())
    })
}

static S_ENVIRONMENTS_FROM_TOML_RECORD_0: wire::Schema = wire::Schema::Dyn;
static S_ENVIRONMENTS_FROM_TOML_RECORD_OUT: wire::Schema =
    wire::Schema::List(&wire::Schema::Obj(&[
        ("name", wire::Schema::Str16),
        ("values", wire::Schema::Map16(&wire::Schema::Str16)),
        (
            "secret_refs",
            wire::Schema::OptJs(&wire::Schema::Map16(&wire::Schema::Obj(&[
                ("provider", wire::Schema::Dyn),
                ("ref", wire::Schema::Dyn),
            ]))),
        ),
    ]));

/// `environmentsFromTomlRecord` over the binary wire.
#[napi(js_name = "environmentsFromTomlRecordWire")]
pub fn environments_from_toml_record_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let record: serde_json::Value = wire::read_value(r, &S_ENVIRONMENTS_FROM_TOML_RECORD_0)?;
        let out = &port::environments_from_toml_record(record)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_ENVIRONMENTS_FROM_TOML_RECORD_OUT.inner())?;
        }
        Ok(())
    })
}

static S_ENVIRONMENT_TO_TOML_DOCUMENT_0: wire::Schema = wire::Schema::Dyn;
static S_ENVIRONMENT_TO_TOML_DOCUMENT_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Dyn);

/// `environmentToTomlDocument` over the binary wire.
#[napi(js_name = "environmentToTomlDocumentWire")]
pub fn environment_to_toml_document_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let environment: serde_json::Value =
            wire::read_value(r, &S_ENVIRONMENT_TO_TOML_DOCUMENT_0)?;
        let out = &port::environment_to_toml_document(environment)?;
        wire::write_value(w, out, &S_ENVIRONMENT_TO_TOML_DOCUMENT_OUT)?;
        Ok(())
    })
}

/// `readTransportFile` over the binary wire.
#[napi(js_name = "readTransportFileWire")]
pub fn read_transport_file_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let file_path: String = r.string16()?;
        let out = &port::read_transport_file(file_path)?;
        w.string16(out);
        Ok(())
    })
}

static S_SORT_STRING_RECORD_0: wire::Schema = wire::Schema::Dyn;
static S_SORT_STRING_RECORD_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Str16);

/// `sortStringRecord` over the binary wire.
#[napi(js_name = "sortStringRecordWire")]
pub fn sort_string_record_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let record: serde_json::Value = wire::read_value(r, &S_SORT_STRING_RECORD_0)?;
        let out = &port::sort_string_record(record)?;
        wire::write_value(w, out, &S_SORT_STRING_RECORD_OUT)?;
        Ok(())
    })
}

/// `assertTomlExtension` over the binary wire.
#[napi(js_name = "assertTomlExtensionWire")]
pub fn assert_toml_extension_wire() -> napi::Result<f64> {
    wire_io(|r, _w| {
        let file_path: String = r.string16()?;
        let () = port::assert_toml_extension(file_path)?;
        Ok(())
    })
}

static S_READ_SCHEMA_HEADER_0: wire::Schema = wire::Schema::Dyn;
static S_READ_SCHEMA_HEADER_OUT: wire::Schema = wire::Schema::Obj(&[
    ("schema", wire::Schema::Str16),
    ("version", wire::Schema::Num),
]);

/// `readSchemaHeader` over the binary wire.
#[napi(js_name = "readSchemaHeaderWire")]
pub fn read_schema_header_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let document: serde_json::Value = wire::read_value(r, &S_READ_SCHEMA_HEADER_0)?;
        let out = &port::read_schema_header(document)?;
        wire::write_value(w, out, &S_READ_SCHEMA_HEADER_OUT)?;
        Ok(())
    })
}

static S_FORMAT_TRANSPORT_TOML_0: wire::Schema = wire::Schema::Dyn;

/// `formatTransportToml` over the binary wire.
#[napi(js_name = "formatTransportTomlWire")]
pub fn format_transport_toml_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let document: serde_json::Value = wire::read_value(r, &S_FORMAT_TRANSPORT_TOML_0)?;
        let out = &port::format_transport_toml(document)?;
        w.string16(out);
        Ok(())
    })
}

static S_WRITE_TRANSPORT_TOML_1: wire::Schema = wire::Schema::Dyn;

/// `writeTransportToml` over the binary wire.
#[napi(js_name = "writeTransportTomlWire")]
pub fn write_transport_toml_wire() -> napi::Result<f64> {
    wire_io(|r, _w| {
        let file_path: String = r.string16()?;
        let document: serde_json::Value = wire::read_value(r, &S_WRITE_TRANSPORT_TOML_1)?;
        let () = port::write_transport_toml(file_path, document)?;
        Ok(())
    })
}
