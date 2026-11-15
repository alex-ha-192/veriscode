import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { scaffoldProject, validateProjectName } from "./projectScaffold";
import { TEMPLATES, TemplateOption } from "./templates";

const TITLE = "New SystemVerilog Project";

async function pickTemplate(): Promise<TemplateOption | undefined> {
  const items = TEMPLATES.map((template) => ({
    label: template.label,
    description: template.description,
    template,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: TITLE, placeHolder: "Choose a starting point" });
  return picked?.template;
}

/** "Veriscode: New SystemVerilog Project": asks for a name, a template and a location, then opens the result. */
export async function newProjectCommand(context: vscode.ExtensionContext): Promise<void> {
  const projectName = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "Project name",
    value: "my_design",
    validateInput: validateProjectName,
  });
  if (!projectName) {
    return;
  }

  const template = await pickTemplate();
  if (!template) {
    return;
  }

  const parentUris = await vscode.window.showOpenDialog({
    title: "Choose a location for the new project",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Create Project Here",
  });
  if (!parentUris || parentUris.length === 0) {
    return;
  }

  const projectDir = path.join(parentUris[0].fsPath, projectName.trim());
  if (fs.existsSync(projectDir)) {
    void vscode.window.showErrorMessage(`"${projectDir}" already exists.`);
    return;
  }
  fs.mkdirSync(projectDir, { recursive: true });
  scaffoldProject(path.join(context.extensionPath, "templates"), projectDir, projectName, template);

  // Keep the current window's workspace intact if it already has one.
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectDir), {
    forceNewWindow: vscode.workspace.workspaceFolders !== undefined,
  });
}
