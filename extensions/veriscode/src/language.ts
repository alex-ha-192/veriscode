import * as vscode from "vscode";

const SV_LANGUAGE_IDS = ["systemverilog", "verilog"];

/** Document selector for every language this extension handles. */
export const SV_SELECTOR: vscode.DocumentSelector = SV_LANGUAGE_IDS.map((language) => ({ language }));

export function isSystemVerilogDoc(document: vscode.TextDocument): boolean {
  return SV_LANGUAGE_IDS.includes(document.languageId);
}
