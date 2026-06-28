/**
 * Which IDE is embedding this webview, detected from the same runtime globals
 * the host bridge uses to pick a transport (see host-bridge.ts):
 *   - "vscode"  — VS Code webview (acquireVsCodeApi)
 *   - "vs"      — Visual Studio WebView2 (window.chrome.webview)
 *   - "browser" — the dev harness / a plain browser
 *
 * Used by the settings dialog to show the right "native branch dialog" preview
 * and label for the current host.
 */

export type HostKind = "vscode" | "vs" | "browser";

export function detectHost(): HostKind {
  if (typeof window.acquireVsCodeApi === "function") return "vscode";
  if (window.chrome?.webview) return "vs";
  return "browser";
}
