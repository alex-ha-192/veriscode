// The Verible integration's vscode-free core (src/verible.ts): parsing
// lint output, locating the binaries, and - when a real Verible is
// available (bundled in ../bin or on PATH) - linting and formatting for
// real. Without one, those last checks are skipped, not failed: Verible is
// fetched at packaging time and isn't part of a plain development checkout.
const fs = require("fs");
const path = require("path");
const { formatText, parseLintOutput, resolveVeribleBinary, runVeribleOnText } = require("../out/verible");
const { ROOT, check, withTempDir, run } = require("./helpers");

// Verbatim verible-verilog-lint v0.0-4080 output.
const LINT_OUTPUT = [
  "/tmp/x/m.sv:1:22: Explicitly define a storage type for every parameter and localparam, (W). [Style: constants] [explicit-parameter-storage-type]",
  "/tmp/x/m.sv:2:18-25: Localparam name does not match the naming convention defined by regex pattern: (([A-Z0-9]+[a-z0-9]*)+(_[0-9]+)?) [Style: constants] [parameter-name-style]",
  "/tmp/x/m.sv:3:16: Use spaces, not tabs. [Style: tabs] [no-tabs]",
  '/tmp/x/broken.sv:1:19-27: syntax error at token "endmodule"',
  "C:\\Users\\sam\\AppData\\Local\\Temp\\m.sv:7:3: Use spaces, not tabs. [Style: tabs] [no-tabs]",
  "",
  "Some line that is not a finding",
].join("\n");

run(async () => {
  const findings = parseLintOutput(LINT_OUTPUT);
  check("parse: one finding per finding line, others ignored", findings.length, 5);
  check("parse: line and column become zero-based", [findings[0].line, findings[0].startCol, findings[0].endCol], [0, 21, 22]);
  check("parse: a column range underlines the whole range", [findings[1].line, findings[1].startCol, findings[1].endCol], [1, 17, 25]);
  check("parse: rule name comes from the last [tag]", findings.map((f) => f.rule), [
    "explicit-parameter-storage-type",
    "parameter-name-style",
    "no-tabs",
    undefined,
    "no-tabs",
  ]);
  check("parse: only the syntax error is flagged as one", findings.map((f) => f.isSyntaxError), [false, false, false, true, false]);
  check("parse: a ranged syntax error is not dropped", findings[3].message, 'syntax error at token "endmodule"');
  check("parse: Windows drive-letter paths", [findings[4].line, findings[4].startCol], [6, 2]);

  // veriscode.verible.path names the *lint* binary; the formatter is its sibling.
  await withTempDir((dir) => {
    const exe = (name) => path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
    fs.writeFileSync(exe("verible-verilog-lint"), "");
    check("binaries: lint uses the override as given", resolveVeribleBinary(dir, "lint", exe("verible-verilog-lint")), exe("verible-verilog-lint"));
    check(
      "binaries: format never runs the lint binary",
      resolveVeribleBinary(dir, "format", exe("verible-verilog-lint")) === exe("verible-verilog-lint"),
      false
    );
    fs.writeFileSync(exe("verible-verilog-format"), "");
    check(
      "binaries: format uses the override's sibling",
      resolveVeribleBinary(dir, "format", exe("verible-verilog-lint")),
      exe("verible-verilog-format")
    );
  });

  const lint = resolveVeribleBinary(ROOT, "lint", undefined);
  const format = resolveVeribleBinary(ROOT, "format", undefined);
  if (!lint || !format) {
    console.log("SKIP real-Verible checks: verible-verilog-lint/-format not bundled or on PATH");
    return;
  }

  const lintText = async (text, fileName, args = []) => {
    const result = await runVeribleOnText(lint, text, fileName, args);
    return parseLintOutput(result.stdout + result.stderr);
  };

  const clean = "module tidy (\n    input  logic a,\n    output logic y\n);\n  assign y = a;\nendmodule\n";
  check("lint: a clean file named after its module has no findings", await lintText(clean, "tidy.sv"), []);
  check(
    "lint: the temp copy keeps the real file name (module-filename sees it)",
    (await lintText(clean, "other.sv")).map((f) => f.rule),
    ["module-filename"]
  );
  const syntaxErrors = await lintText("module m(input a; endmodule\n", "m.sv");
  check("lint: syntax errors are reported", syntaxErrors.length > 0 && syntaxErrors.every((f) => f.isSyntaxError));

  const formatted = await formatText(format, "module tidy(input logic a,output logic y);assign y=a;endmodule\n", "tidy.sv");
  // (Line endings aside: VS Code applies an edit using the document's own.)
  check("format: tidies the buffer", formatted?.replace(/\r\n/g, "\n"), clean);
  check(
    "format: a file with a syntax error is left alone (no error text as 'formatted' output)",
    await formatText(format, "module m(input a; endmodule\n", "m.sv"),
    undefined
  );
  check("format: a formatter that can't be launched makes no edit", await formatText(path.join(ROOT, "no-such-binary"), clean, "tidy.sv"), undefined);

  // Everything the extension scaffolds should be lint-clean with the rules
  // that are on by default (package.json's veriscode.verible.disabledRules).
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const disabled = manifest.contributes.configuration
    .map((section) => section.properties["veriscode.verible.disabledRules"])
    .find(Boolean).default;
  const rules = disabled.length > 0 ? [`--rules=${disabled.map((rule) => `-${rule}`).join(",")}`] : [];
  const templates = ["default.sv", ...fs.readdirSync(path.join(ROOT, "templates", "workshop")).map((f) => path.join("workshop", f))];
  for (const template of templates.filter((f) => f.endsWith(".sv"))) {
    const text = fs.readFileSync(path.join(ROOT, "templates", template), "utf8");
    check(`templates/${template}: lint-clean with the default rules`, await lintText(text, path.basename(template), rules), []);
  }
});
