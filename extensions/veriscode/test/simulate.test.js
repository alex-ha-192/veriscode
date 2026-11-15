// The simulation pipeline end to end, through real iverilog/vvp: generate
// a testbench for a parsed module, compile, run, and sample the VCD.
const path = require("path");
const fs = require("fs");
const { buildDefaultSteps } = require("../out/simulation/defaultSteps");
const { FIXTURES, ROOT, check, parseFile, simulateFile, withTempDir, run } = require("./helpers");

run(async () => {
  // Clocked: one step is one clock cycle, sampled after the rising edge.
  const counter = await simulateFile(path.join(FIXTURES, "counter.sv"), [
    { rst_n: "0", en: "0" },
    { rst_n: "1", en: "0" },
    { rst_n: "1", en: "1" },
    { rst_n: "1", en: "1" },
    { rst_n: "1", en: "0" },
    { rst_n: "1", en: "1" },
  ]);
  check("counter: counts only while enabled", counter.count, ["0", "0", "1", "2", "2", "3"]);

  // Combinational: one step is a time slice. The 5-bit sum shows carry-out.
  const adder = await simulateFile(path.join(FIXTURES, "adder.sv"), [
    { a: "4'd3", b: "4'd4" },
    { a: "4'd15", b: "4'd1" },
    { a: "4'd0", b: "4'd0" },
  ]);
  check("adder: sums, including carry-out", adder.sum, ["7", "16", "0"]);

  // Multi-file: full_adder instantiates half_adder from a sibling file,
  // which must be found and compiled alongside it automatically. This is
  // what the workshop's multi-module stages depend on.
  const bits = ["0", "1"];
  const truthTable = bits.flatMap((a) => bits.flatMap((b) => bits.map((cin) => ({ a, b, cin }))));
  const fullAdder = await simulateFile(path.join(FIXTURES, "multimodule", "full_adder.sv"), truthTable);
  // The submodules have signals named a, b and sum too; each row of the
  // diagram must still be the top-level port, not a same-named inner signal.
  check("full_adder: input rows read back exactly what was driven", [fullAdder.a, fullAdder.b, fullAdder.cin], [
    truthTable.map((step) => step.a),
    truthTable.map((step) => step.b),
    truthTable.map((step) => step.cin),
  ]);
  check("full_adder (sibling file): sum", fullAdder.sum, ["0", "1", "1", "0", "1", "0", "0", "1"]);
  check("full_adder (sibling file): cout", fullAdder.cout, ["0", "0", "0", "1", "0", "1", "1", "1"]);

  // What a brand-new user sees: the starter template, simulated with the
  // default steps (a one-cycle reset pulse, everything else 0).
  const starter = path.join(ROOT, "templates", "default.sv");
  const firstClick = await simulateFile(starter, buildDefaultSteps(parseFile(starter), 4));
  check("starter template: first Simulate click works", firstClick.count, ["0", "0", "0", "0"]);

  await withTempDir(async (dir) => {
    // The diagram shows unknown / undriven values as x / z, and its legend
    // invites typing them back in - as bare letters, not SystemVerilog's 'x.
    const buffer = path.join(dir, "tristate.sv");
    fs.writeFileSync(
      buffer,
      "module tristate (input logic [3:0] d, input logic en, output logic [3:0] q, output logic y);\n" +
        "  assign q = en ? d : 4'bz;\n  assign y = en ? d[0] : 1'bz;\nendmodule\n"
    );
    const tristate = await simulateFile(buffer, [
      { d: "4'hA", en: "1" },
      { d: "x", en: "1" },
      { d: "5", en: "0" },
      { d: "Z", en: "1" },
      { d: "", en: "1" },
    ]);
    check("x / z cells: bus values", tristate.q, ["10", "x", "z", "z", "x"]);
    check("x / z cells: 1-bit values", tristate.y, ["0", "x", "z", "z", "x"]);

    // Buses wider than 53 bits must not be rounded through a double.
    const wide = path.join(dir, "wide.sv");
    fs.writeFileSync(wide, "module wide (input logic [63:0] d, output logic [63:0] q);\n  assign q = d + 64'd1;\nendmodule\n");
    const wideResult = await simulateFile(wide, [{ d: "64'hFFFF_FFFF_FFFF_FFFE" }, { d: "64'd9007199254740992" }]);
    check("64-bit values are exact", wideResult.q, ["18446744073709551615", "9007199254740993"]);

    // A design that doesn't compile reports the compiler's output instead of throwing.
    const broken = path.join(dir, "broken.sv");
    fs.writeFileSync(broken, "module broken (input logic a, output logic y);\n  assign y = a &&& ;\nendmodule\n");
    const { simulate } = require("../out/simulation/icarusRunner");
    const failure = await simulate(parseFile(broken), broken, [{ a: "0" }], 10, { extensionPath: ROOT });
    check("compile error: reported, not thrown", [failure.ok, failure.signals.length, /broken\.sv:2/.test(failure.log)], [false, 0, true]);
  });
});
