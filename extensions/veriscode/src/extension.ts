import * as vscode from "vscode";
import { composeTopCommand } from "./composeTop";
import { isSystemVerilogDoc, SV_SELECTOR } from "./language";
import { newProjectCommand } from "./newProject";
import { SimulateCodeLensProvider } from "./simulateCodeLens";
import { formatWithVerible, VeribleLinter } from "./veribleLint";
import { SimulatorPanel } from "./webview/panel";
import { SidebarViewProvider } from "./webview/sidebarView";

/** How long to wait after the last keystroke before linting as you type. */
const LINT_ON_TYPE_DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, new SidebarViewProvider(context)),
    vscode.languages.registerCodeLensProvider(SV_SELECTOR, new SimulateCodeLensProvider()),
    ...registerCommands(context),
    ...registerVerible(context)
  );
}

export function deactivate(): void {
  // Disposables registered via context.subscriptions handle cleanup.
}

function registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("veriscode.newProject", () => newProjectCommand(context)),
    vscode.commands.registerCommand("veriscode.composeTop", (uri?: vscode.Uri) => composeTopCommand(context, uri)),
    vscode.commands.registerCommand("veriscode.simulate", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        void vscode.window.showErrorMessage("Open a SystemVerilog file to simulate.");
        return;
      }
      const document = await vscode.workspace.openTextDocument(targetUri);
      const cycles = vscode.workspace.getConfiguration("veriscode.simulator").get<number>("defaultCycles", 8);
      await SimulatorPanel.show(context, document, cycles);
    }),
  ];
}

/** Linting (on open, save and as you type) and formatting, both backed by Verible. */
function registerVerible(context: vscode.ExtensionContext): vscode.Disposable[] {
  const linter = new VeribleLinter(context.extensionPath);
  const setting = (name: string, fallback: boolean): boolean =>
    vscode.workspace.getConfiguration("veriscode.verible").get<boolean>(name, fallback);

  for (const doc of vscode.workspace.textDocuments) {
    void linter.lint(doc);
  }

  return [
    linter,
    vscode.workspace.onDidOpenTextDocument((doc) => void linter.lint(doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (setting("lintOnSave", true)) {
        void linter.lint(doc);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isSystemVerilogDoc(e.document) && setting("lintOnType", true)) {
        linter.scheduleLint(e.document, LINT_ON_TYPE_DEBOUNCE_MS);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => linter.clear(doc.uri)),
    // A changed rule list or binary applies straight away, not at the next edit.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("veriscode.verible")) {
        for (const doc of vscode.workspace.textDocuments) {
          void linter.lint(doc);
        }
      }
    }),

    vscode.languages.registerDocumentFormattingEditProvider(SV_SELECTOR, {
      async provideDocumentFormattingEdits(document) {
        const formatted = await formatWithVerible(context.extensionPath, document);
        if (formatted === undefined || formatted === document.getText()) {
          return [];
        }
        const wholeDocument = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        return [vscode.TextEdit.replace(wholeDocument, formatted)];
      },
    }),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (isSystemVerilogDoc(e.document) && setting("formatOnSave", false)) {
        e.waitUntil(
          vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", e.document.uri)
        );
      }
    }),
  ];
}
