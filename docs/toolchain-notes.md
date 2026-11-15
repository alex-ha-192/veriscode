# Toolchain notes

How Veriscode finds, bundles and runs Verible and Icarus Verilog, what
has actually been verified against the real tools, and what hasn't.

## How bundling works

The release `.vsix` carries the toolchains for every platform under
`extensions/veriscode/bin/<platform>-<arch>/`. At run time
`resolveBinary()` (`src/toolchain.ts`) looks for a binary in this order:

1. the user's override setting, if set;
2. the bundled directory for this machine;
3. `PATH`.

A development checkout has no `bin/` (it is git-ignored), so it simply
falls through to `PATH`.

**Emulation fallback.** Neither tool ships a native Windows-on-ARM build,
so on `win32-arm64` the `win32-x64` directory is used, which runs under
Windows 11's x64 emulation (Prism). macOS gets the same fallback through
Rosetta 2, though a native `darwin-arm64` build is bundled anyway. Linux
has no such emulation layer, so `linux-arm64` never falls back to x64.

**Relocating Icarus Verilog.** Icarus bakes the absolute path of its
support directory (`ivl`, the code generators, the `.vpi` modules) into
the `iverilog` binary and into every compiled `.vvp` file, so a copied
install doesn't work by itself (steveicarus/iverilog#1344).
`icarusRunner.ts` passes the bundled `lib/` directory to `iverilog` with
`-B` and to `vvp` through `IVERILOG_VPI_MODULE_PATH`.

**Verible** ships static binaries, so it needs no such handling. The
pinned release is in `toolchains/manifest.json`.

## Verified against the real tools

- **Simulation**, end to end with a real `iverilog`/`vvp`: module-header
  parsing (including parameterized widths), testbench generation, VCD
  parsing and sample timing, for clocked, combinational and multi-file
  designs, and for all six workshop stages - both the reference solutions
  and the unfilled templates. `npm test` runs this on every push, on amd64
  and arm64 Linux.
- **Verible lint and format**, with the pinned v0.0-4080 release (CI
  fetches it with `toolchains/fetch-verible.sh` before the tests). Doing
  this turned up behaviour that reading the documentation hadn't:
  - `verible-verilog-format` "fails safe" by default: on a syntax error
    it exits 0, echoes the input on stdout and reports the error on
    stderr. The extension passes `--failsafe_success=false` and only ever
    applies stdout.
  - Lint findings can carry a column *range* (`file:1:19-27: ...`), which
    syntax errors always do.
  - The `module-filename` rule reads the name of the file it is given, so
    the temp copy used to lint an unsaved buffer keeps the real file name.
  - With the default rule set, every bundled template is lint-clean
    (`test/verible.test.js` checks this).
- **Icarus relocation**: `toolchains/fetch-icarus-linux.sh` copied
  `iverilog`, `vvp` and the support directory out of `/usr` into the
  extension's `bin/linux-x64/` layout, the system copies were deleted,
  and the simulation tests still passed using only the relocated copy.
- **Platform fallback**: `test/toolchain.test.js` covers the cases above,
  including the negative one (no x64 fallback on Linux arm64), and the
  override / bundled / `PATH` order.
- **Packaging**: the extension compiles under `tsc --strict` and packages
  into a valid `.vsix` with `@vscode/vsce`.
- **The webviews** (simulator, schematic, top-module builder, sidebar)
  were run in headless Chromium with the real extension-host classes
  behind them and the production Content-Security-Policy in force. That
  matters: the CSP blocks inline `style` attributes, which a page opened
  without it would never reveal.

## Performance

A full compile-and-simulate of the workshop's largest design (the CPU,
12 clock cycles) takes about 15 ms with real `iverilog` + `vvp`.
`test/perf.test.js` asserts a deliberately generous 500 ms ceiling, to
catch a gross regression without flaking on shared CI runners.

Process spawn dominates that time, so in-process micro-optimizations
don't pay at this scale. Two things are still worth keeping:

- Cell edits are debounced by 150 ms (`SET_VALUE_DEBOUNCE_MS` in
  `panel.ts`), so a burst of edits is one run, not one per keystroke.
- VCD changes are grouped by signal once per run (`groupChangesById`),
  so sampling each port is a lookup rather than a scan of every change.

## Lessons from the first real CI runs

Both failures came from assuming an archive layout, and both were fixed by
searching for content instead:

- `fetch-verible.sh` (Windows zip): the archive's entries use backslash
  separators, which `python3 -m zipfile` does not turn into directories on
  POSIX. The script now prefers `unzip`, and finds each binary by name
  wherever it landed rather than expecting a `bin/` directory.
- `fetch-icarus-*.sh`: Icarus's support directory is called `ivl` on
  Debian but not under Homebrew. The scripts now locate it by finding the
  directory that contains a `.vpi` module.

If another layout surprise shows up, the fix is likely the same shape:
read the failing step's log, and search by content rather than by name.

## Not yet verified

- The Windows and macOS Icarus fetch scripts have been fixed against the
  failures CI reported, but the bundled result has not been exercised end
  to end on those platforms.
- The webviews have been verified in Chromium against VS Code's theme
  variables, not inside a running VS Code window.
