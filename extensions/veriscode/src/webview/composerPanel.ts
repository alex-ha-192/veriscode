import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LibraryModule } from "../generation/moduleLibrary";
import { ComposerSpec, generateTopModule, validateComposerSpec } from "../generation/topGenerator";
import { PortDirection } from "../simulation/types";
import { DisposableWebviewPanel } from "./disposableWebviewPanel";
import { renderWebviewPage, webviewOptions } from "./webviewUtils";

interface ClientState {
  folderName: string;
  library: { name: string; ports: { name: string; direction: PortDirection; width: number }[] }[];
}

/** Messages from media/composer.js. */
type FromWebview = { type: "ready" } | { type: "generate"; spec: ComposerSpec };

type ToWebview =
  | { type: "init"; state: ClientState }
  | { type: "generateResult"; ok: true; fileName: string }
  | { type: "generateResult"; ok: false; errors: string[] };

/**
 * A GUI for building a top-level module out of modules the student has
 * already written, without hand-writing instantiation syntax: pick modules
 * from a palette, wire ports to net names, declare the top module's own
 * ports, then Generate writes out real, readable SystemVerilog. It is the
 * counterpart of the simulator's read-only Logical Schematic tab: that
 * one draws an existing module's structure, this one produces a new file.
 */
export class ComposerPanel extends DisposableWebviewPanel<ToWebview> {
  private static current: ComposerPanel | undefined;

  static async show(context: vscode.ExtensionContext, folder: string, library: LibraryModule[]): Promise<void> {
    if (ComposerPanel.current) {
      ComposerPanel.current.refresh(folder, library);
      ComposerPanel.current.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel("veriscode.composer", "Build Top Module", vscode.ViewColumn.Beside, {
      ...webviewOptions(context.extensionUri),
      retainContextWhenHidden: true,
    });
    const instance = new ComposerPanel(context, panel, folder, library);
    ComposerPanel.current = instance;
    panel.onDidDispose(() => {
      if (ComposerPanel.current === instance) {
        ComposerPanel.current = undefined;
      }
    });
  }

  private constructor(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private folder: string,
    private library: LibraryModule[]
  ) {
    super(panel);
    this.panel.webview.html = renderWebviewPage(panel.webview, context.extensionUri, {
      title: "Build Top Module",
      styles: ["base.css", "style.css"],
      scripts: ["schematicCanvas.js", "composer.js"],
      body: COMPOSER_BODY,
    });
    this.panel.webview.onDidReceiveMessage((msg: FromWebview) => this.handleMessage(msg));
  }

  private refresh(folder: string, library: LibraryModule[]): void {
    this.folder = folder;
    this.library = library;
    this.post({ type: "init", state: this.clientState() });
  }

  private clientState(): ClientState {
    return {
      folderName: path.basename(this.folder) || this.folder,
      library: this.library.map(({ module }) => ({
        name: module.name,
        ports: module.ports.map((p) => ({ name: p.name, direction: p.direction, width: p.width })),
      })),
    };
  }

  private async handleMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({ type: "init", state: this.clientState() });
        break;
      case "generate":
        this.post(await this.generate(msg.spec));
        break;
    }
  }

  /** Validates the spec, writes `<topName>.sv` into the folder and opens it. */
  private async generate(spec: ComposerSpec): Promise<ToWebview> {
    const failed = (...errors: string[]): ToWebview => ({ type: "generateResult", ok: false, errors });

    // The webview's state is just a message payload: re-check it here
    // before anything touches the disk.
    const moduleTypes = new Set(this.library.map(({ module }) => module.name));
    const errors = validateComposerSpec(spec, moduleTypes);
    if (errors.length > 0) {
      return failed(...errors);
    }

    // Never offer to overwrite one of the building blocks themselves:
    // other modules in the folder may depend on it. (Any other existing
    // file gets a normal overwrite prompt below.)
    const topName = spec.topName.trim();
    if (moduleTypes.has(topName)) {
      return failed(
        `"${topName}" is already the name of one of your existing modules - choose a different name for the top module.`
      );
    }

    const fileName = `${topName}.sv`;
    const targetPath = path.join(this.folder, fileName);
    if (fs.existsSync(targetPath)) {
      const choice = await vscode.window.showWarningMessage(
        `"${fileName}" already exists in this folder. Overwrite it?`,
        { modal: true },
        "Overwrite"
      );
      if (choice !== "Overwrite") {
        return failed("Cancelled - a file with that name already exists.");
      }
    }

    try {
      fs.writeFileSync(targetPath, generateTopModule({ ...spec, topName }), "utf8");
    } catch (err) {
      return failed(`Couldn't write the file: ${err instanceof Error ? err.message : err}`);
    }

    const doc = await vscode.workspace.openTextDocument(targetPath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    return { type: "generateResult", ok: true, fileName };
  }
}

const COMPOSER_BODY = `
  <h1>Build Top Module</h1>
  <p class="subtitle" id="subtitle"></p>

  <div class="composer-layout">
    <aside class="composer-palette">
      <h2>Your modules</h2>
      <div id="paletteList"></div>
      <p class="legend">Click a module to add it to the canvas.</p>
    </aside>

    <div class="composer-main">
      <div class="toolbar">
        <label class="top-name-label">
          Top module name
          <input type="text" id="topName" class="text-input" value="top" spellcheck="false" />
        </label>
        <button class="secondary" id="addPort">+ Top-Level Port</button>
        <button id="generate">Generate SystemVerilog</button>
      </div>
      <pre id="errorLog" class="log error" hidden></pre>
      <p id="successLog" class="composer-success" role="status" hidden></p>
      <div class="schematic-canvas" id="canvas"></div>
      <p class="legend">
        Type a net name next to each port to wire things together: ports that share a net name
        are connected, and a net named after a top-level port connects straight to that port.
        Drag a box by its title bar to move it.
      </p>
      <datalist id="netNames"></datalist>
    </div>
  </div>`;
