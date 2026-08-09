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
    let canonical = std::fs::read_to_string(&cap_path).expect("read default capabilities");
    let e2e = std::env::var("CARGO_FEATURE_E2E").is_ok();

    if !e2e {
        let stripped = strip_wdio_permissions(&canonical);
        std::fs::write(&cap_path, stripped).expect("write stripped capabilities");
    }

    let _guard = CapabilitiesRestoreGuard {
        path: cap_path,
        canonical,
    };

    tauri_build::build();
}

fn strip_wdio_permissions(json: &str) -> String {
    let mut value: serde_json::Value =
        serde_json::from_str(json).expect("parse default capabilities");
    if let Some(perms) = value.get_mut("permissions").and_then(|p| p.as_array_mut()) {
        perms.retain(|p| {
            p.as_str() != Some("wdio:default") && p.as_str() != Some("wdio-webdriver:default")
        });
    }
    format!(
        "{}\n",
        serde_json::to_string_pretty(&value).expect("serialize capabilities")
    )
}
