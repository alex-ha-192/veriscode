# Veriscode

Learn SystemVerilog without leaving the editor: linting and formatting by
Verible, and a simulator you drive by clicking values into a timing
diagram. Icarus Verilog runs underneath; there is no testbench to write.

## Getting started

1. **File → New File... → SystemVerilog Project** (or the Veriscode icon
   in the Activity Bar). Pick a template - the counter is the quickest way
   to see everything work, and *Workshop: Build a Simple CPU* is a guided
   1-2 hour course.
2. Click **▶ Simulate** above a module. A timing diagram opens beside your
   code, with one column per clock cycle.
3. Click an input cell and type a value (`0`, `1`, `x`, `4'hA`...). The
   outputs update. **+ Cycle** adds a column.
4. Edit the code and save: the diagram re-runs with the values you already
   entered.

## Also included

- **Logical Schematic** - the simulator's second tab draws the module, the
  modules it instantiates, and the wires between them.
- **Build Top Module (GUI)** - wire modules you've written into a new
  top-level module by naming nets; it writes the instantiation code.
- **Format Document** and lint-as-you-type, both by Verible.

## Good to know

- A project is a folder: every `.sv`/`.v` file next to the one you
  simulate is compiled with it.
- A port named `clk` or `clock` is driven as the clock, and reset-like
  ports (`rst_n`, `reset`...) start with a one-cycle reset pulse.
- Settings live under **Veriscode** in the Settings editor, including
  which lint rules are off and paths to your own tool binaries.
