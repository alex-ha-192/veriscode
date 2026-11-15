// Performance regression guard: one compile+simulate of the workshop's
// largest design (the CPU). Every cell edit in the simulator triggers
// exactly one of these, so it has to stay interactive. A run measures
// ~15ms on a dev machine; the threshold is deliberately generous so this
// only catches a gross regression (an accidental O(n^2), a blocking call
// in the hot path), not ordinary shared-CI-runner variance.
const path = require("path");
const { SOLUTIONS, check, simulateFile, run } = require("./helpers");

// Starting a process is several times slower on Windows.
const THRESHOLD_MS = process.platform === "win32" ? 2000 : 500;
const RUNS = 6;

run(async () => {
  const cpu = path.join(SOLUTIONS, "06_simple_cpu.sv");
  const steps = Array.from({ length: 12 }, (_, i) => ({
    rst_n: i === 0 ? "0" : "1",
    load_en: "0",
    load_addr: "0",
    load_instr: "0",
  }));

  await simulateFile(cpu, steps); // Warm-up: the first spawn pays OS/fs caching costs.

  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const started = Date.now();
    await simulateFile(cpu, steps);
    times.push(Date.now() - started);
  }
  const average = times.reduce((a, b) => a + b, 0) / RUNS;
  console.log(`simulate() over ${RUNS} runs (ms): ${times.join(", ")} - average ${average.toFixed(1)}`);
  check(`average simulate() time is under ${THRESHOLD_MS}ms`, average < THRESHOLD_MS);
});
