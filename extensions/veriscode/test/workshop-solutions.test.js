// The CPU workshop's reference solutions (fixtures/workshop-solutions),
// checked against real iverilog. These are the ground truth the
// student-facing templates are derived from: if this stops passing, the
// workshop is broken.
const path = require("path");
const { buildDefaultSteps } = require("../out/simulation/defaultSteps");
const { SOLUTIONS, check, parseFile, simulateFile, run } = require("./helpers");

const solution = (name) => path.join(SOLUTIONS, name);

run(async () => {
  // 01/02: half adder and full adder truth tables.
  const bits = ["0", "1"];
  const half = await simulateFile(solution("01_half_adder.sv"), bits.flatMap((a) => bits.map((b) => ({ a, b }))));
  check("half adder: sum", half.sum, ["0", "1", "1", "0"]);
  check("half adder: carry", half.carry, ["0", "0", "0", "1"]);

  const full = await simulateFile(
    solution("02_full_adder.sv"),
    bits.flatMap((a) => bits.flatMap((b) => bits.map((cin) => ({ a, b, cin }))))
  );
  check("full adder: sum", full.sum, ["0", "1", "1", "0", "1", "0", "0", "1"]);
  check("full adder: cout", full.cout, ["0", "0", "0", "1", "0", "1", "1", "1"]);

  // 03: every ALU operation, and the zero flag.
  const alu = await simulateFile(solution("03_alu.sv"), [
    { a: "4'd6", b: "4'd3", op: "2'b00" }, // ADD
    { a: "4'd6", b: "4'd3", op: "2'b01" }, // SUB
    { a: "4'd6", b: "4'd3", op: "2'b10" }, // AND
    { a: "4'd6", b: "4'd3", op: "2'b11" }, // OR
    { a: "4'd5", b: "4'd5", op: "2'b01" }, // SUB to zero
  ]);
  check("alu: ADD, SUB, AND, OR, SUB", alu.result, ["9", "3", "2", "7", "0"]);
  check("alu: zero flag set only for a zero result", alu.zero, ["0", "0", "0", "0", "1"]);

  // 04: reset, load, hold (en=0 must ignore d), load again.
  const register = await simulateFile(solution("04_register.sv"), [
    { rst_n: "0", en: "0", d: "8'd0" },
    { rst_n: "1", en: "1", d: "8'd42" },
    { rst_n: "1", en: "0", d: "8'd99" },
    { rst_n: "1", en: "1", d: "8'd7" },
  ]);
  check("register: reset, load, hold, load", register.q, ["0", "42", "42", "7"]);

  // 05: write two registers, then read both back through the two read ports.
  const registerFile = await simulateFile(solution("05_register_file.sv"), [
    { rst_n: "0", we: "0", waddr: "0", wdata: "0", raddr1: "0", raddr2: "1" },
    { rst_n: "1", we: "1", waddr: "2'd1", wdata: "8'd11", raddr1: "0", raddr2: "1" },
    { rst_n: "1", we: "1", waddr: "2'd2", wdata: "8'd22", raddr1: "2'd1", raddr2: "2'd2" },
    { rst_n: "1", we: "0", waddr: "0", wdata: "0", raddr1: "2'd1", raddr2: "2'd2" },
  ]);
  check("register file: reads back reg1 and reg2", [registerFile.rdata1[3], registerFile.rdata2[3]], ["11", "22"]);

  // 06: the capstone CPU. First the preloaded demo program, with nothing
  // but the default steps - exactly a student's first Simulate click:
  //   LDA 8; ADD 9; STA 10; HALT   with mem[8]=3, mem[9]=5.
  const cpu = solution("06_simple_cpu.sv");
  const demo = await simulateFile(cpu, buildDefaultSteps(parseFile(cpu), 8));
  check("cpu demo program: pc advances then stops at HALT", demo.pc, ["0", "1", "2", "3", "3", "3", "3", "3"]);
  check("cpu demo program: acc = 3 + 5", demo.acc[7], "8");
  check("cpu demo program: halted", demo.halted[7], "1");

  // Then a different program entered through load_en, the way a student
  // does it from the grid: hold in reset, write the words, release, run.
  //   LDA 8; SUB 9; STA 11; HALT   with mem[8]=10, mem[9]=4.
  const idle = { rst_n: "1", load_en: "0", load_addr: "0", load_instr: "0" };
  const load = (addr, instr) => ({ rst_n: "1", load_en: "1", load_addr: String(addr), load_instr: instr });
  const loaded = await simulateFile(cpu, [
    { ...idle, rst_n: "0" },
    load(0, "8'b0001_1000"), // LDA 8
    load(1, "8'b0011_1001"), // SUB 9
    load(2, "8'b0100_1011"), // STA 11
    load(3, "8'b1111_0000"), // HALT
    load(8, "8'd10"),
    load(9, "8'd4"),
    idle, // LDA
    idle, // SUB
    idle, // STA
    idle, // HALT
  ]);
  check("cpu loaded program: acc = 10 - 4", loaded.acc[10], "6");
  check("cpu loaded program: halted", loaded.halted[10], "1");
});
