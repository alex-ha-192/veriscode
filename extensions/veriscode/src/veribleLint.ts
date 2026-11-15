import * as path from "path";
import * as vscode from "vscode";
import { isSystemVerilogDoc } from "./language";
import { formatText, parseLintOutput, resolveVeribleBinary, runVeribleOnText } from "./verible";

function veribleConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("veriscode.verible");
}

/** The name Verible should see for this document (an untitled buffer has no real one). */
function fileNameFor(document: vscode.TextDocument): string {
  const name = path.basename(document.uri.fsPath);
  if (path.extname(name)) {
    return name;
  }
  return `${name || "untitled"}${document.languageId === "verilog" ? ".v" : ".sv"}`;
}

export class VeribleLinter implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("verible");
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  // The latest lint started for each document: `id` so a slow earlier run
  // can't overwrite the diagnostics of a newer one, and `input` (everything
  // the result depends on) so the same text isn't linted twice - as it
  // otherwise would be on every save that follows typing.
  private readonly latestRun = new Map<string, { id: number; input: string }>();

  constructor(private readonly extensionPath: string) {}

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.collection.dispose();
  }

  /** Lints after `debounceMs` of quiet, collapsing a burst of keystrokes into one run. */
  scheduleLint(document: vscode.TextDocument, debounceMs: number): void {
    const key = document.uri.toString();
    this.cancelScheduled(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.lint(document);
      }, debounceMs)
    );
  }

  async lint(document: vscode.TextDocument): Promise<void> {
    if (!isSystemVerilogDoc(document) || document.uri.scheme !== "file") {
      return;
    }
    const config = veribleConfig();
    const bin = resolveVeribleBinary(this.extensionPath, "lint", config.get<string>("path"));
    if (!bin) {
      return; // No bundled or PATH copy of Verible: linting is simply off.
    }

    const disabledRules = config.get<string[]>("disabledRules") ?? [];
    const args = disabledRules.length > 0 ? [`--rules=${disabledRules.map((rule) => `-${rule}`).join(",")}`] : [];

    const key = document.uri.toString();
    const previous = this.latestRun.get(key);
    const input = [document.version, bin, ...args].join("\n");
    if (previous?.input === input) {
      return; // This exact text has already been linted with these rules.
    }
    const id = (previous?.id ?? 0) + 1;
    this.latestRun.set(key, { id, input });

    let output: string;
    try {
      const result = await runVeribleOnText(bin, document.getText(), fileNameFor(document), args);
      output = result.stdout + result.stderr;
    } catch {
      this.latestRun.delete(key); // Couldn't launch the binary at all: let the next event try again.
      return;
    }
    if (this.latestRun.get(key)?.id !== id) {
      return; // Superseded by a newer run, or the document was closed meanwhile.
    }

    const diagnostics = parseLintOutput(output).map((finding) => {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(finding.line, finding.startCol, finding.line, finding.endCol),
        finding.message,
        finding.isSyntaxError ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "verible";
      diagnostic.code = finding.rule;
      return diagnostic;
    });
    this.collection.set(document.uri, diagnostics);
  }

  /** Forgets a closed document: drops its diagnostics and any lint still pending or in flight. */
  clear(uri: vscode.Uri): void {
    const key = uri.toString();
    this.cancelScheduled(key);
    this.latestRun.delete(key);
    this.collection.delete(uri);
  }

  private cancelScheduled(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}

/** Returns the formatted document text, or undefined if there's nothing safe to apply. */
export async function formatWithVerible(
  extensionPath: string,
  document: vscode.TextDocument
): Promise<string | undefined> {
  const bin = resolveVeribleBinary(extensionPath, "format", veribleConfig().get<string>("path"));
  if (!bin) {
    return undefined;
  }
  return formatText(bin, document.getText(), fileNameFor(document));
}
