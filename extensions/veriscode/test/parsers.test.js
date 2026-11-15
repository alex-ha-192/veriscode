// The lightweight text parsers the simulator is built on: module headers
// (src/simulation/portParser.ts) and VCD waveform dumps (vcdParser.ts).
const { parseModule, parseParamDefaults, stripComments } = require("../out/simulation/portParser");
const { groupChangesById, parseVcd, sampleSignal } = require("../out/simulation/vcdParser");
const { check, run } = require("./helpers");

run(() => {
  const module = parseModule(`
    // module decoy (input logic nope);
    module shifter #(
      parameter int WIDTH = 8,
      parameter DEPTH = 4   /* no type keyword */
    ) (
      input  logic                 clk,
      input  logic                 rst_n, load,
      input  wire  [WIDTH-1:0]     d,
      input  logic [WIDTH*2-1:0]   wide,
      input  logic [$clog2(DEPTH)-1:0] sel,
      output logic [WIDTH-1:0]     q,
      output logic signed [0:3]    ascending,
      inout  wire                  pad
    );
    endmodule
  `);
  const port = (name) => module.ports.find((p) => p.name === name);
  check("module: name, skipping a commented-out declaration", module.name, "shifter");
  check("module: ports in declaration order", module.ports.map((p) => p.name), [
    "clk", "rst_n", "load", "d", "wide", "sel", "q", "ascending", "pad",
  ]);
  check("module: a port without a direction inherits the previous one", port("load").direction, "input");
  check("module: directions", [port("q").direction, port("pad").direction], ["output", "inout"]);
  check("module: width from a parameter's default", [port("d").width, port("d").declRange], [8, "[7:0]"]);
  check("module: width from an expression", port("wide").width, 16);
  check("module: an unresolvable width falls back to 32 bits", port("sel").width, 32);
  check("module: ascending range", port("ascending").width, 4);
  check("module: single bit", [port("clk").width, port("clk").declRange], [1, undefined]);
  check("module: clock and reset are recognised", [port("clk").isClockLike, port("rst_n").resetPolarity], [true, "active-low"]);

  check("module: no module in the text", parseModule("// just a comment\n"), null);
  check("module: no port list", parseModule("module empty;\nendmodule\n").ports, []);
  check("params: with and without a type keyword", parseParamDefaults("parameter int A = 3, parameter B = -2"), { A: 3, B: -2 });
  check("comments: stripped, line count preserved", stripComments("a // x\n/* y\n z */ b\n"), "a \n  \n    b\n");

  const vcd = parseVcd(
    [
      "$timescale 1ps $end",
      "$scope module tb $end",
      "$var wire 1 ! clk $end",
      "$var wire 8 \" count [7:0] $end",
      "$var wire 4 # bus [3:0] $end",
      "$upscope $end",
      "$enddefinitions $end",
      "#0",
      "0!",
      "b0 \"",
      "bx #",
      "#5000",
      "1!",
      "b101 \"",
      "#10000",
      "bz1z #",
      "b11111111 \"",
    ].join("\n")
  );
  check("vcd: variables, with the range stripped from the name", vcd.vars, [
    { id: "!", name: "clk", width: 1 },
    { id: '"', name: "count", width: 8 },
    { id: "#", name: "bus", width: 4 },
  ]);
  const byId = groupChangesById(vcd.changes);
  check("vcd: timescale converts times to ns", byId.get("!").map((c) => c.timeNs), [0, 5]);
  check("vcd: vectors are decimal", sampleSignal(byId.get('"'), [0, 4, 5, 9, 10, 99]), ["0", "0", "5", "5", "255", "255"]);
  check("vcd: any x or z bit makes the value x or z", sampleSignal(byId.get("#"), [0, 10]), ["x", "z"]);
  check("vcd: before a signal's first change it is x", sampleSignal([{ timeNs: 5, id: "!", value: "1" }], [0, 5]), ["x", "1"]);
});
