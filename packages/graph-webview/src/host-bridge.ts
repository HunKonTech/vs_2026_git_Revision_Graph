import type { HostToWebview, WebviewToHost } from "@rev-graph/protocol";

type Listener = (msg: HostToWebview) => void;

/** Abstracts the messaging channel to whichever host embeds the webview. */
export interface HostBridge {
  post(msg: WebviewToHost): void;
  onMessage(cb: Listener): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void };
    chrome?: {
      webview?: {
        postMessage(msg: unknown): void;
        addEventListener(type: string, cb: (e: { data: unknown }) => void): void;
      };
    };
    /** Set by the dev browser harness to capture outgoing messages. */
    __REV_GRAPH_HARNESS__?: { onPost(msg: WebviewToHost): void };
  }
}

/**
 * Pick the right transport at runtime:
 *  - VS Code webview  -> acquireVsCodeApi()
 *  - Visual Studio    -> window.chrome.webview (WebView2)
 *  - dev browser      -> window.postMessage + harness hook
 */
export function createHostBridge(): HostBridge {
  const listeners: Listener[] = [];
  const emit = (msg: HostToWebview) => listeners.forEach((l) => l(msg));

  if (typeof window.acquireVsCodeApi === "function") {
    const vscode = window.acquireVsCodeApi();
    window.addEventListener("message", (e) => emit(e.data as HostToWebview));
    return { post: (m) => vscode.postMessage(m), onMessage: (cb) => listeners.push(cb) };
  }

  if (window.chrome?.webview) {
    const wv = window.chrome.webview;
    wv.addEventListener("message", (e) => {
      const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      emit(data as HostToWebview);
    });
    return { post: (m) => wv.postMessage(JSON.stringify(m)), onMessage: (cb) => listeners.push(cb) };
  }

  // Browser harness fallback.
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d && typeof d === "object" && "type" in d) emit(d as HostToWebview);
  });
  return {
    post: (m) => {
      window.__REV_GRAPH_HARNESS__?.onPost(m);
      console.log("[rev-graph] -> host", m);
    },
    onMessage: (cb) => listeners.push(cb),
  };
}
