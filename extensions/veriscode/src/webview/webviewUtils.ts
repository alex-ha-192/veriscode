import * as vscode from "vscode";

/** A fresh per-render nonce: the CSP only runs <script> tags that carry it. */
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/** Webview options shared by every view: scripts on, and only media/ readable. */
export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")] };
}

export interface WebviewPage {
  title: string;
  /** Stylesheet file names inside media/, in load order. */
  styles: string[];
  /** Script file names inside media/, in load order. */
  scripts: string[];
  /** The page's <body> markup. */
  body: string;
}

/**
 * Renders the HTML document every webview in this extension shares: one
 * locked-down CSP (no network, only our own stylesheets and images, and
 * only nonce'd scripts), then the page's stylesheets, body and scripts.
 *
 * Note for body markup: this CSP also blocks inline `style="..."`
 * attributes. Use a class, or the `hidden` attribute, instead.
 */
export function renderWebviewPage(webview: vscode.Webview, extensionUri: vscode.Uri, page: WebviewPage): string {
  const nonce = getNonce();
  const mediaUri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", file));
  const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
  const styleTags = page.styles.map((file) => `  <link rel="stylesheet" href="${mediaUri(file)}" />`);
  const scriptTags = page.scripts.map((file) => `  <script nonce="${nonce}" src="${mediaUri(file)}"></script>`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
${styleTags.join("\n")}
  <title>${page.title}</title>
</head>
<body>
${page.body}
${scriptTags.join("\n")}
</body>
</html>`;
}
