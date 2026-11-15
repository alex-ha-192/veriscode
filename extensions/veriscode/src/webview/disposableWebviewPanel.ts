import * as vscode from "vscode";

/**
 * Shared plumbing for the editor-area webview panels: remembers whether
 * the panel has been closed, and drops messages posted after that (VS
 * Code throws if you post to a disposed webview, and a simulation can
 * easily finish after its panel was closed).
 */
export abstract class DisposableWebviewPanel<ToWebview> {
  protected disposed = false;

  protected constructor(protected readonly panel: vscode.WebviewPanel) {
    panel.onDidDispose(() => {
      this.disposed = true;
    });
  }

  protected post(message: ToWebview): void {
    if (!this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }
}
