// End-to-end test for the GUI composer's code generation path: scan a
// folder for existing modules (moduleLibrary), compose a ComposerSpec that
// wires two half_adder instances into a chain purely via direct
// port-to-net connections (the only thing the composer's GUI can express -
// no glue logic/expressions, matching its "structural netlist, not a
// schematic capture tool" scope), generate SystemVerilog from it, and
// confirm the *generated* file actually compiles and simulates correctly
// through real iverilog - not just that the string looks plausible.
//
// Note this chain is deliberately NOT a bit-perfect full_adder: a real
// full adder's carry-out is `carry0 | carry1` (an OR of both half-adders'
// carries), which needs glue logic the pure structural composer doesn't
// have. Instead ha1's carry is wired straight out as the top-level
// carry_out, so carry_out = (a^b) & cin - a different, but well-defined
// and independently checkable, circuit.
const fs = require("fs");
const path = require("path");
const { listModulesInFolder } = require("../out/generation/moduleLibrary");
const { generateTopModule, validateComposerSpec } = require("../out/generation/topGenerator");
const { parseModule } = require("../out/simulation/portParser");
const { FIXTURES, check, simulateFile, withTempDir, run } = require("./helpers");

run(() =>
  withTempDir(async (tmpDir) => {
    fs.copyFileSync(path.join(FIXTURES, "multimodule", "half_adder.sv"), path.join(tmpDir, "half_adder.sv"));

    const library = listModulesInFolder(tmpDir);
    check("library: finds exactly half_adder", library.length === 1 && library[0].module.name === "half_adder");

    const halfAdder = library[0].module;

    function connectionsFor(mapping) {
      return halfAdder.ports.map((p) => ({
        portName: p.name,
        direction: p.direction,
        width: p.width,
        netName: mapping[p.name],
      }));
    }

    const spec = {
      topName: "half_adder_chain",
      topPorts: [
        { name: "a", direction: "input", width: 1 },
        { name: "b", direction: "input", width: 1 },
        { name: "cin", direction: "input", width: 1 },
        { name: "sum", direction: "output", width: 1 },
        { name: "carry_out", direction: "output", width: 1 },
      ],
      instances: [
        {
          instanceName: "ha0",
          moduleType: "half_adder",
          // ha0's carry is left dangling (wired to an internal net that
          // nothing else reads) - a legitimate, if useless, wiring choice
          // that should still generate and compile cleanly.
          connections: connectionsFor({ a: "a", b: "b", sum: "sum0", carry: "carry0" }),
        },
        {
          instanceName: "ha1",
          moduleType: "half_adder",
          // carry wired straight to the top-level port name - a direct
          // connection, not a separate internal net.
          connections: connectionsFor({ a: "sum0", b: "cin", sum: "sum", carry: "carry_out" }),
        },
      ],
    };

    const generated = generateTopModule(spec);

    check("generated: declares internal nets sum0, carry0", /logic sum0, carry0;/.test(generated));
    check("generated: instantiates ha0 and ha1", /half_adder ha0 \(/.test(generated) && /half_adder ha1 \(/.test(generated));
    check("generated: ha1.carry connects directly to the carry_out port", /\.carry\(carry_out\)/.test(generated));
    const netDeclLine = generated.split("\n").find((line) => /^\s{2}logic /.test(line));
    check(
      "generated: carry_out is not separately declared as an internal net (it's a top port)",
      !new RegExp(`\\bcarry_out\\b`).test(netDeclLine ?? "")
    );

    const genPath = path.join(tmpDir, "half_adder_chain.sv");
    fs.writeFileSync(genPath, generated, "utf8");

    const module = parseModule(generated);
    check("generated module reparses with the right name and 5 ports", module && module.name === "half_adder_chain" && module.ports.length === 5);
    check("sum0/carry0 did not leak into the top port list", !module.ports.some((p) => p.name === "sum0" || p.name === "carry0"));

    const steps = [];
    for (const a of ["0", "1"]) {
      for (const b of ["0", "1"]) {
        for (const cin of ["0", "1"]) {
          steps.push({ a, b, cin });
        }
      }
    }
    const outputs = await simulateFile(genPath, steps);
    check(
      "generated module simulates: sum = a ^ b ^ cin",
      outputs.sum,
      steps.map((s) => String(Number(s.a) ^ Number(s.b) ^ Number(s.cin)))
    );
    check(
      "generated module simulates: carry_out = (a ^ b) & cin",
      outputs.carry_out,
      steps.map((s) => String((Number(s.a) ^ Number(s.b)) & Number(s.cin)))
    );

    // The extension host re-validates whatever the webview sends before writing a file.
    const moduleTypes = new Set(["half_adder"]);
    check("validation: the spec above is accepted", validateComposerSpec(spec, moduleTypes), []);
    const problems = (change) => validateComposerSpec({ ...spec, ...change }, moduleTypes).length;
    check("validation: a top name that isn't an identifier", problems({ topName: "2 fast" }), 1);
    check("validation: no instances", problems({ instances: [] }), 1);
    check("validation: duplicate top-level port", problems({ topPorts: [...spec.topPorts, spec.topPorts[0]] }), 1);
    check("validation: duplicate instance name", problems({ instances: [spec.instances[0], spec.instances[0]] }), 1);
    check(
      "validation: a module that isn't in the folder",
      problems({ instances: [{ ...spec.instances[0], moduleType: "mystery" }] }),
      1
    );
    check(
      "validation: a net name that isn't an identifier",
      problems({ instances: [{ ...spec.instances[0], connections: connectionsFor({ a: "a b", b: "b", sum: "s", carry: "c" }) }] }),
      1
    );
  })
);
