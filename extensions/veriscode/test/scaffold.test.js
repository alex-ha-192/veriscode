// "New Project" scaffolding (src/projectScaffold.ts) for every template in
// the picker: the right files land, and - where a broken cross-reference
// would only show at compile time - the result simulates with real iverilog.
const fs = require("fs");
const path = require("path");
const { moduleNameFor, scaffoldProject, validateProjectName } = require("../out/projectScaffold");
const { TEMPLATES } = require("../out/templates");
const { ROOT, check, simulateFile, withTempDir, run } = require("./helpers");

const TEMPLATES_DIR = path.join(ROOT, "templates");
const template = (id) => TEMPLATES.find((t) => t.id === id);

run(async () => {
  for (const t of TEMPLATES) {
    check(`${t.id}: every listed file exists`, t.files.filter((f) => !fs.existsSync(path.join(TEMPLATES_DIR, f))), []);
  }

  check("project name: plain name is fine", validateProjectName("my design"), undefined);
  check("project name: blank is rejected", typeof validateProjectName("   "), "string");
  for (const bad of ["a/b", "..\\up", "..", "what?"]) {
    check(`project name: "${bad}" is rejected`, typeof validateProjectName(bad), "string");
  }
  check("module name: spaces and dashes become underscores", moduleNameFor(" my-first design "), "my_first_design");
  check("module name: can't start with a digit", moduleNameFor("8bit"), "m_8bit");

  // Counter: the one template whose module and file are renamed to the project.
  await withTempDir(async (dir) => {
    scaffoldProject(TEMPLATES_DIR, dir, "blinky 2", template("counter"));
    check("counter: file is named after the project", fs.readdirSync(dir).sort(), ["README.md", "blinky_2.sv"]);
    const source = fs.readFileSync(path.join(dir, "blinky_2.sv"), "utf8");
    check("counter: module is renamed", [/\bmodule blinky_2\b/.test(source), /\bmodule counter\b/.test(source)], [true, false]);
    check("counter: README points at the file", fs.readFileSync(path.join(dir, "README.md"), "utf8").includes("`blinky_2.sv`"));
    const result = await simulateFile(path.join(dir, "blinky_2.sv"), [{ rst_n: "0", en: "1" }, { rst_n: "1", en: "1" }]);
    check("counter: renamed project simulates", result.count, ["0", "1"]);
  });

  // Full adder: two files copied verbatim, so the cross-reference still resolves.
  await withTempDir(async (dir) => {
    scaffoldProject(TEMPLATES_DIR, dir, "adders", template("full_adder"));
    check("full_adder: both files and a README", fs.readdirSync(dir).sort(), ["01_half_adder.sv", "02_full_adder.sv", "README.md"]);
    check("full_adder: README points at the top file", fs.readFileSync(path.join(dir, "README.md"), "utf8").includes("`02_full_adder.sv`"));
    await simulateFile(path.join(dir, "02_full_adder.sv"), [{ a: "1", b: "1", cin: "1" }]);
    check("full_adder: scaffolded project simulates", true);
  });

  // Workshop: all six stages, with the guide as the README.
  await withTempDir(async (dir) => {
    scaffoldProject(TEMPLATES_DIR, dir, "cpu", template("cpu-workshop"));
    check("workshop: six stages and a README", fs.readdirSync(dir).length, 7);
    check(
      "workshop: README is the guide",
      fs.readFileSync(path.join(dir, "README.md"), "utf8"),
      fs.readFileSync(path.join(TEMPLATES_DIR, "workshop", "GUIDE.md"), "utf8")
    );
    await simulateFile(path.join(dir, "06_simple_cpu.sv"), [
      { rst_n: "0", load_en: "0", load_addr: "0", load_instr: "0" },
      { rst_n: "1", load_en: "0", load_addr: "0", load_instr: "0" },
    ]);
    check("workshop: capstone simulates from the scaffolded folder", true);
  });
});
