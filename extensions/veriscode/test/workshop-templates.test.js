// Every student-facing workshop template must compile and simulate with
// its TODOs still unfilled. The templates use safe placeholders (e.g.
// `q <= q;`) rather than gaps precisely so that a student's very first
// Simulate click shows wrong-but-not-broken output to debug - never a
// wall of compiler errors before they've written a line.
const path = require("path");
const { simulate } = require("../out/simulation/icarusRunner");
const { ROOT, check, parseFile, run } = require("./helpers");

const cases = {
  "01_half_adder.sv": [{ a: "1", b: "1" }],
  "02_full_adder.sv": [{ a: "1", b: "1", cin: "1" }],
  "03_alu.sv": [{ a: "4'd6", b: "4'd3", op: "2'b01" }],
  "04_register.sv": [
    { rst_n: "0", en: "0", d: "0" },
    { rst_n: "1", en: "1", d: "8'd42" },
  ],
  "05_register_file.sv": [
    { rst_n: "0", we: "0", waddr: "0", wdata: "0", raddr1: "0", raddr2: "1" },
    { rst_n: "1", we: "1", waddr: "1", wdata: "8'd9", raddr1: "0", raddr2: "1" },
  ],
  "06_simple_cpu.sv": [
    { rst_n: "0", load_en: "0", load_addr: "0", load_instr: "0" },
    { rst_n: "1", load_en: "0", load_addr: "0", load_instr: "0" },
    { rst_n: "1", load_en: "0", load_addr: "0", load_instr: "0" },
  ],
};

run(async () => {
  for (const [name, steps] of Object.entries(cases)) {
    const file = path.join(ROOT, "templates", "workshop", name);
    const result = await simulate(parseFile(file), file, steps, 10, { extensionPath: ROOT });
    if (!result.ok) console.log(result.log);
    check(`${name}: simulates with its TODOs unfilled`, result.ok);
  }
});
