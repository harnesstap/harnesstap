import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ActionToastVisualGallery } from "./components/live/ActionToastVisualGallery";
import { HarnessScopeVisualGallery } from "./components/live/HarnessScopeVisualGallery";
import { RiskyRemovalVisualGallery } from "./components/live/RiskyRemovalVisualGallery";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-ext-400.css";
import "@fontsource/ibm-plex-sans/latin-ext-500.css";
import "@fontsource/ibm-plex-sans/latin-ext-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-ext-400.css";
import "@fontsource/ibm-plex-mono/latin-ext-500.css";
import "./styles.css";

if (import.meta.env.VITE_E2E === "1") {
  void import("@wdio/tauri-plugin");
}

function Root() {
  const visual = new URLSearchParams(window.location.search).get("visual");
  if (visual === "harness-scope") {
    return <HarnessScopeVisualGallery />;
  }
  if (visual === "risky-removal") {
    return <RiskyRemovalVisualGallery />;
  }
  if (visual === "action-toast") {
    return <ActionToastVisualGallery />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
