import { ParsedModule, Port, SimStep } from "./types";

const TB_MODULE_NAME = "__veriscode_tb";

export interface TestbenchOptions {
  vcdPath: string;
  clockPeriodNs: number;
}

function declFor(port: Port): string {
  return port.declRange ? `logic ${port.declRange} ${port.name}` : `logic ${port.name}`;
}

function sanitizeValue(raw: string | undefined): string {
  // A step missing a value entirely (e.g. a port introduced after the
  // step table was built - normally backfilled by backfillSteps, but
  // this is the last line of defense) drives 'x, same as an explicitly
  // blank cell, rather than crashing testbench generation.
  const v = (raw ?? "").trim();
  return v.length > 0 ? v : "'x";
}

/**
 * Generates a self-contained testbench that instantiates the DUT, drives
 * every input port to the value requested for each step, and dumps a VCD.
 * For clocked designs (a port that looks like `clk`/`clock`), one step is
 * one clock cycle; otherwise each step is a fixed-size time slice.
 */
export function generateTestbench(module: ParsedModule, steps: SimStep[], opts: TestbenchOptions): string {
  const clockPort = module.ports.find((p) => p.isClockLike && p.direction === "input");
  const inputs = module.ports.filter((p) => p.direction === "input" && p !== clockPort);
  const outputs = module.ports.filter((p) => p.direction !== "input");

  const lines: string[] = [];
  lines.push("`timescale 1ns/1ps");
  lines.push(`module ${TB_MODULE_NAME};`);

  if (clockPort) {
    lines.push(`  logic ${clockPort.name} = 0;`);
  }
  for (const p of [...inputs, ...outputs]) {
    lines.push(`  ${declFor(p)};`);
  }

  const portConns = module.ports.map((p) => `.${p.name}(${p.name})`).join(", ");
  lines.push(`  ${module.name} dut (${portConns});`);
  lines.push("");

  if (clockPort) {
    const half = opts.clockPeriodNs / 2;
    lines.push(`  always #${half} ${clockPort.name} = ~${clockPort.name};`);
    lines.push("");
  }

  lines.push(`  initial begin`);
  lines.push(`    $dumpfile("${opts.vcdPath.replace(/\\/g, "\\\\")}");`);
  lines.push(`    $dumpvars(0, ${TB_MODULE_NAME});`);

  if (steps.length === 0) {
    // Nothing to drive: fall through to $finish.
  } else if (clockPort) {
    // Step 0's inputs are set up before the first rising edge; each
    // subsequent step's inputs are latched in right after the previous
    // edge (with a 1ns settle) so the DUT's post-edge outputs for step k
    // are sampled cleanly before step k+1's inputs change.
    for (const p of inputs) {
      lines.push(`    ${p.name} = ${sanitizeValue(steps[0][p.name])};`);
    }
    for (let i = 0; i < steps.length; i++) {
      lines.push(`    @(posedge ${clockPort.name});`);
      if (i + 1 < steps.length) {
        lines.push(`    #1;`);
        for (const p of inputs) {
          lines.push(`    ${p.name} = ${sanitizeValue(steps[i + 1][p.name])};`);
        }
      }
    }
    lines.push(`    #${opts.clockPeriodNs / 2};`);
  } else {
    const slice = opts.clockPeriodNs;
    for (const step of steps) {
      for (const p of inputs) {
        lines.push(`    ${p.name} = ${sanitizeValue(step[p.name])};`);
      }
      lines.push(`    #${slice};`);
    }
  }

  lines.push(`    $finish;`);
  lines.push(`  end`);
  lines.push(`endmodule`);
  return lines.join("\n");
}

/** Simulation-time (ns) at which step `index` should be sampled from the VCD. */
export function sampleTimeForStep(index: number, module: ParsedModule, clockPeriodNs: number): number {
  const hasClock = module.ports.some((p) => p.isClockLike && p.direction === "input");
  if (hasClock) {
    // Rising edges land at half a period + k periods; reading at that
    // timestamp picks up the values the edge just produced.
    return clockPeriodNs / 2 + index * clockPeriodNs;
  }
  // Combinational: just before the end of the step's time slice.
  return (index + 1) * clockPeriodNs - 1;
}
