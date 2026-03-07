import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Initialize MCP plugin listeners for E2E testing (dev-debug builds only).
// Use a variable to prevent Vite from statically analyzing the import.
const mcpModule = "tauri-plugin-mcp";
import(/* @vite-ignore */ mcpModule).then(({ setupPluginListeners }) => {
  setupPluginListeners();
  console.log("MCP plugin listeners initialized");
}).catch(() => {
  // Plugin not available — ignore
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
