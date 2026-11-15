import * as path from "path";
import * as vscode from "vscode";
import { isSystemVerilogDoc } from "../language";
import { parseModule } from "../simulation/portParser";
import { renderWebviewPage, webviewOptions } from "./webviewUtils";

/** The sidebar's buttons; each one runs the `veriscode.*` command of the same name. */
const BUTTON_COMMANDS = ["newProject", "composeTop", "simulate"];

/** Messages from media/sidebar.js: "ready", or the name of the button that was clicked. */
interface FromSidebar {
  type: string;
}

/**
 * The Activity Bar view: quick actions (New Project, Build Top Module,
 * Simulate) plus a live summary of the module in the active editor. It is
 * a launcher, not the simulator itself - a per-cycle grid needs the width
 * of an editor tab, so that opens as its own panel (SimulatorPanel).
 */
export class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "veriscode.home";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.pushActiveModule()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          this.pushActiveModule();
        }
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = webviewOptions(this.context.extensionUri);
    webviewView.webview.html = renderWebviewPage(webviewView.webview, this.context.extensionUri, {
      title: "Veriscode",
      styles: ["base.css", "sidebar.css"],
      scripts: ["sidebar.js"],
      body: SIDEBAR_BODY,
    });

    webviewView.webview.onDidReceiveMessage((msg: FromSidebar) => {
      if (msg.type === "ready") {
        this.pushActiveModule();
      } else if (BUTTON_COMMANDS.includes(msg.type)) {
        void vscode.commands.executeCommand(`veriscode.${msg.type}`);
      }
    });
  }

  private pushActiveModule(): void {
    if (!this.view) return;
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isSystemVerilogDoc(document)) {
      void this.view.webview.postMessage({ type: "activeModule", fileName: null, module: null });
      return;
    }
    const module = parseModule(document.getText());
    void this.view.webview.postMessage({
      type: "activeModule",
      fileName: path.posix.basename(document.uri.path),
      module: module ? { name: module.name, ports: module.ports } : null,
    });
  }
}

const SIDEBAR_BODY = `
  <button id="newProject">New SystemVerilog Project</button>
  <button class="secondary" id="composeTop">Build Top Module</button>

  <h2>Active file</h2>
  <p id="emptySection" class="muted">Open a .sv file to see it here.</p>
  <div id="activeSection" hidden>
    <div class="module-name" id="moduleName"></div>
    <div class="file-name" id="fileName"></div>
    <ul id="portList"></ul>
    <button class="secondary" id="simulate">▶ Simulate</button>
  </div>`;
