// Minimal Tauri IPC shim for running the desktop UI in a plain browser.
// Installed by scripts/ui-shots.mjs via page.addInitScript(), before any app
// code runs. No imports: this file is evaluated as a classic script.
//
// Inputs (set on window by the harness before this script runs):
//   __HT_AGENT_PORT__   port of a manually started ht-agent (default 7474)
//   __HT_TOKEN__        contents of ~/.harnesstap/agent-token, or null
//   __HT_PROJECT_PATH__ directory returned by the folder-picker dialog
(function installTauriShim() {
  if (window.__TAURI_INTERNALS__) {
    return;
  }

  var callbacks = new Map();
  var nextCallbackId = 1;

  function randomId() {
    return Math.floor(Math.random() * 0xffffffff);
  }

  function agentPort() {
    return Number(window.__HT_AGENT_PORT__ ?? 7474);
  }

  function invoke(cmd, args) {
    switch (cmd) {
      case "start_sidecar":
      case "restart_sidecar":
      case "get_sidecar_port":
        return Promise.resolve(agentPort());
      case "read_agent_token":
        return Promise.resolve(window.__HT_TOKEN__ ?? null);
      case "e2e_project_path":
        return Promise.resolve(window.__HT_PROJECT_PATH__ ?? null);
      case "plugin:event|listen":
        return Promise.resolve(randomId());
      case "plugin:event|unlisten":
      case "plugin:shell|open":
        return Promise.resolve(null);
      case "plugin:dialog|open":
        return Promise.resolve(window.__HT_PROJECT_PATH__ ?? null);
      default:
        console.warn("[tauri-shim] unhandled invoke", cmd, args);
        return Promise.resolve(null);
    }
  }

  function transformCallback(callback, once) {
    var id = nextCallbackId++;
    callbacks.set(id, function (payload) {
      if (once) {
        callbacks.delete(id);
      }
      if (typeof callback === "function") {
        callback(payload);
      }
    });
    return id;
  }

  function unregisterCallback(id) {
    callbacks.delete(id);
  }

  function convertFileSrc(filePath, protocol) {
    var scheme = protocol || "asset";
    return scheme + "://localhost/" + encodeURIComponent(String(filePath));
  }

  window.__TAURI_INTERNALS__ = {
    invoke: invoke,
    transformCallback: transformCallback,
    unregisterCallback: unregisterCallback,
    convertFileSrc: convertFileSrc,
    callbacks: callbacks,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
  };

  // @tauri-apps/api/event's unlisten() calls this directly.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function () {},
  };
})();
