import * as fs from "fs";
import * as path from "path";
import { TemplateOption } from "./templates";

/**
 * The file-writing half of "New Project", kept free of any `vscode` import
 * so it can be exercised from plain node (see test/scaffold.test.js);
 * newProject.ts is the interactive half.
 */

/** Returns why `name` can't be used as a project folder name, or undefined if it can. */
export function validateProjectName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Enter a project name.";
  }
  if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === "." || trimmed === "..") {
    return 'A project name is a single folder name: it can\'t contain \\ / : * ? " < > |';
  }
  return undefined;
}

/** Turns a free-form project name into a legal SystemVerilog identifier, e.g. "my design" -> "my_design". */
export function moduleNameFor(projectName: string): string {
  const cleaned = projectName.trim().replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `m_${cleaned}`;
}

/**
 * Populates the (existing, empty) `projectDir` from `template`, whose
 * files live under `templatesDir`: the source file(s) plus a README.
 */
export function scaffoldProject(
  templatesDir: string,
  projectDir: string,
  projectName: string,
  template: TemplateOption
): void {
  if (template.kind === "single-renamed") {
    const moduleName = moduleNameFor(projectName);
    writeRenamed(path.join(templatesDir, template.files[0]), projectDir, moduleName);
    writeStarterReadme(projectDir, projectName, `${moduleName}.sv`);
    return;
  }

  for (const relPath of template.files) {
    fs.copyFileSync(path.join(templatesDir, relPath), path.join(projectDir, path.basename(relPath)));
  }
  if (template.kind === "workshop") {
    fs.copyFileSync(path.join(templatesDir, "workshop", "GUIDE.md"), path.join(projectDir, "README.md"));
  } else {
    // The last file listed is the one that builds on the others.
    writeStarterReadme(projectDir, projectName, path.basename(template.files[template.files.length - 1]));
  }
}

/** Copies a one-module template, renaming both the module and its file to `moduleName`. */
function writeRenamed(templatePath: string, projectDir: string, moduleName: string): void {
  const source = fs.readFileSync(templatePath, "utf8");
  const renamed = source.replace(/\bmodule\s+[A-Za-z_][A-Za-z0-9_$]*/, `module ${moduleName}`);
  fs.writeFileSync(path.join(projectDir, `${moduleName}.sv`), renamed, "utf8");
}

function writeStarterReadme(projectDir: string, projectName: string, mainFile: string): void {
  const readme = [
    `# ${projectName.trim()}`,
    "",
    "A SystemVerilog project created with Veriscode.",
    "",
    `- Edit \`${mainFile}\` - Verible lints it as you type.`,
    '- Click **▶ Simulate** above the module (or run "Veriscode: Simulate") to step through it',
    "  cycle by cycle with a live timing diagram.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(projectDir, "README.md"), readme, "utf8");
}
