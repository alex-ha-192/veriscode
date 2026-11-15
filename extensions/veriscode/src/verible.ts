import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveBinary } from "./toolchain";

/**
 * The vscode-free half of the Verible integration: locating the binaries,
 * running them against in-memory text, and parsing lint output. Kept free
 * of any `vscode` import so it can be exercised from plain node (see
 * test/verible.test.js); veribleLint.ts is the thin editor-facing layer.
 */

const LINT_BINARY = "verible-verilog-lint";
const FORMAT_BINARY = "verible-verilog-format";

export type VeribleTool = "lint" | "format";

/**
 * Finds the binary for `tool`. The `veriscode.verible.path` setting points
 * at the *lint* binary, so for the formatter it only tells us which
 * directory to look in - its sibling verible-verilog-format is used if
 * present. (Running the lint binary as a formatter would replace the
 * document with lint output.) Falls back to the bundled/PATH copy.
 */
export function resolveVeribleBinary(
  extensionPath: string,
  tool: VeribleTool,
  lintPathOverride: string | undefined
): string | undefined {
  const override = lintPathOverride?.trim();
  if (tool === "lint") {
    return resolveBinary(extensionPath, LINT_BINARY, override);
  }
  if (override) {
    const exe = process.platform === "win32" ? `${FORMAT_BINARY}.exe` : FORMAT_BINARY;
    const sibling = path.join(path.dirname(override), exe);
    if (fs.existsSync(sibling)) {
      return sibling;
    }
  }
  return resolveBinary(extensionPath, FORMAT_BINARY, undefined);
}

export interface VeribleRun {
  /** Exit code, or null if the process was killed by a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a Verible tool against `text` - the document's *current in-memory
 * contents*, not its on-disk file - by writing it to a temp copy and
 * pointing the tool at that. This keeps lint-as-you-type and Format
 * Document correct while the buffer has unsaved edits. The temp copy
 * keeps the real file's name (in a private temp directory) because
 * Verible's rules look at it, e.g. module-filename.
 *
 * Rejects only if the process can't be launched at all; a non-zero exit
 * is a normal result (that's how lint reports violations).
 */
export async function runVeribleOnText(
  bin: string,
  text: string,
  fileName: string,
  extraArgs: string[]
): Promise<VeribleRun> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "veriscode-verible-"));
  const tempPath = path.join(dir, path.basename(fileName));
  try {
    fs.writeFileSync(tempPath, text, "utf8");
    return await run(bin, [...extraArgs, tempPath]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(bin: string, args: string[]): Promise<VeribleRun> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export interface LintFinding {
  /** Zero-based line. */
  line: number;
  /** Zero-based start column. */
  startCol: number;
  /** Zero-based, exclusive end column. */
  endCol: number;
  message: string;
  /** The rule name from the trailing "[rule-name]" tag, when present. */
  rule?: string;
  /** True for parse failures, as opposed to style-rule violations. */
  isSyntaxError: boolean;
}

// "file:line:col: message" or "file:line:col-endcol: message". The message
// usually ends in a "[rule-name]" tag, but that isn't required: syntax
// errors have none, and the exact tagging has drifted across releases.
const FINDING_LINE = /^.*?:(\d+):(\d+)(?:-(\d+))?:\s*(.*)$/;
const RULE_TAG = /\[([\w.:-]+)\]\s*$/;

/** Parses verible-verilog-lint's output, ignoring any line that isn't a finding. */
export function parseLintOutput(output: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const match = FINDING_LINE.exec(rawLine.trim());
    if (!match) {
      continue;
    }
    const [, lineStr, colStr, endColStr, message] = match;
    const startCol = Math.max(0, Number(colStr) - 1);
    findings.push({
      line: Math.max(0, Number(lineStr) - 1),
      startCol,
      // Verible's "col-endcol" range is inclusive; without one, mark one character.
      endCol: endColStr ? Math.max(startCol + 1, Number(endColStr)) : startCol + 1,
      message: message.trim(),
      rule: RULE_TAG.exec(message)?.[1],
      isSyntaxError: /^syntax error\b/i.test(message),
    });
  }
  return findings;
}

/**
 * Formats `text`, returning undefined when there is nothing safe to apply:
 * the formatter couldn't run, or it rejected the input (e.g. a syntax
 * error). Only stdout is ever used as the result - Verible reports
 * problems on stderr, which must never end up in the user's file.
 */
export async function formatText(bin: string, text: string, fileName: string): Promise<string | undefined> {
  let result: VeribleRun;
  try {
    // By default the formatter "fails safe": it exits 0 and echoes the
    // input back on a syntax error. Ask for a real exit code instead.
    result = await runVeribleOnText(bin, text, fileName, ["--failsafe_success=false"]);
  } catch {
    return undefined;
  }
  return result.code === 0 ? result.stdout : undefined;
}
