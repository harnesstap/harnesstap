struct CapabilitiesRestoreGuard {
    path: std::path::PathBuf,
    canonical: String,
}

impl Drop for CapabilitiesRestoreGuard {
    fn drop(&mut self) {
        let _ = std::fs::write(&self.path, &self.canonical);
    }
}

fn main() {
    let cap_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
    let e2e = std::env::var("CARGO_FEATURE_E2E").is_ok();

    // Never mutate capabilities during normal/dev builds: writing the watched
    // file triggers `tauri dev` into an infinite rebuild loop.
    // Only e2e builds temporarily inject WDIO permissions (one-shot `tauri build`).
    let _guard = if e2e {
        let canonical = std::fs::read_to_string(&cap_path).expect("read default capabilities");
        let with_wdio = inject_wdio_permissions(&canonical);
        std::fs::write(&cap_path, &with_wdio).expect("write e2e capabilities");
        Some(CapabilitiesRestoreGuard {
            path: cap_path,
            canonical,
        })
    } else {
        None
    };

    tauri_build::build();
}

fn inject_wdio_permissions(json: &str) -> String {
    let mut value: serde_json::Value =
        serde_json::from_str(json).expect("parse default capabilities");
    if let Some(perms) = value.get_mut("permissions").and_then(|p| p.as_array_mut()) {
        let wdio = ["wdio:default", "wdio-webdriver:default"];
        let mut insert_at = perms
            .iter()
            .position(|p| p.as_str() == Some("core:default"))
            .map(|i| i + 1)
            .unwrap_or(0);
        for perm in wdio {
            let already = perms.iter().any(|p| p.as_str() == Some(perm));
            if !already {
                perms.insert(insert_at, serde_json::Value::String(perm.to_string()));
                insert_at += 1;
            }
        }
    }
    format!(
        "{}\n",
        serde_json::to_string_pretty(&value).expect("serialize capabilities")
    )
}
