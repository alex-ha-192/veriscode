// Shared plumbing for the test scripts in this folder. Each *.test.js is a
// plain node script (no test framework) that exercises the compiled
// extension code in ../out - and, for anything that simulates, a real
// iverilog - then exits non-zero if any check failed. `npm test` runs
// them all via run.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { simulate } = require("../out/simulation/icarusRunner");
const { parseModule } = require("../out/simulation/portParser");

/** The extension's root folder. */
const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");
/** Reference solutions for the six workshop stages. */
const SOLUTIONS = path.join(FIXTURES, "workshop-solutions");

let failures = 0;

/** Records one check: `actual` must deep-equal `expected`, or be true if no `expected` is passed. */
function check(label, actual, ...rest) {
  const expected = rest.length > 0 ? rest[0] : true;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`PASS ${label}`);
  } else {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** Parses the module in `file`, failing loudly if there isn't one. */
function parseFile(file) {
  const module = parseModule(fs.readFileSync(file, "utf8"));
  if (!module) throw new Error(`no module declaration found in ${file}`);
  return module;
}

/**
 * Simulates `file` through real iverilog and returns {signalName: values[]}
 * (one value per step). Throws, with the compiler log, if the run fails.
 */
async function simulateFile(file, steps) {
  const result = await simulate(parseFile(file), file, steps, 10, { extensionPath: ROOT });
  if (!result.ok) throw new Error(`simulating ${path.basename(file)} failed:\n${result.log}`);
  return Object.fromEntries(result.signals.map((signal) => [signal.name, signal.values]));
}

/** Runs `fn` with a fresh temp directory, removed afterwards. */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "veriscode-test-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a test script's body, then reports and exits with the outcome. */
function run(main) {
  Promise.resolve()
    .then(main)
    .then(() => {
      console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
      process.exit(failures === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { ROOT, FIXTURES, SOLUTIONS, check, parseFile, simulateFile, withTempDir, run };
