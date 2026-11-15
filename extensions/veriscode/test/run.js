// `npm test`: runs every *.test.js in this folder, each in its own node
// process, and prints a one-line verdict per file (plus the full output of
// any that fail). Pass file names to run just those, e.g.
//   node test/run.js verible.test.js
// Requires a compiled extension (`npm run compile`) and iverilog on PATH.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const requested = process.argv.slice(2);
const files = requested.length > 0 ? requested : fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();

const failed = [];
for (const file of files) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: "utf8" });
  const output = result.stdout + result.stderr;
  const ok = result.status === 0;
  const checks = (output.match(/^PASS /gm) ?? []).length;
  const skipped = (output.match(/^SKIP /gm) ?? []).length;
  const detail = `${checks} checks${skipped > 0 ? `, ${skipped} skipped` : ""}, ${Date.now() - started}ms`;
  console.log(`${ok ? "ok  " : "FAIL"} ${file} (${detail})`);
  if (!ok) {
    failed.push(file);
    console.log(output.replace(/^/gm, "     "));
  } else if (skipped > 0) {
    console.log(output.match(/^SKIP .*$/gm).join("\n").replace(/^/gm, "     "));
  }
}

console.log(failed.length === 0 ? `\nAll ${files.length} test files passed.` : `\n${failed.length} of ${files.length} test files failed: ${failed.join(", ")}`);
process.exit(failed.length === 0 ? 0 : 1);
