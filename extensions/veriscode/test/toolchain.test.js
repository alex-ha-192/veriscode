// Toolchain lookup (src/toolchain.ts): which bundled bin/<platform>-<arch>
// directory applies to a machine - including the arm64 -> x64 emulation
// fallback on Windows and macOS - and the override / bundled / PATH order.
const fs = require("fs");
const path = require("path");
const { resolveBinary, resolveBundledPlatformDir } = require("../out/toolchain");
const { check, withTempDir, run } = require("./helpers");

/** Runs `fn` with process.platform / process.arch temporarily replaced. */
function withPlatform(platform, arch, fn) {
  const real = { platform: process.platform, arch: process.arch };
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: real.platform, configurable: true });
    Object.defineProperty(process, "arch", { value: real.arch, configurable: true });
  }
}

run(() =>
  withTempDir((ext) => {
    for (const dir of ["win32-x64", "darwin-arm64", "linux-x64"]) {
      fs.mkdirSync(path.join(ext, "bin", dir), { recursive: true });
    }
    const platformDir = (platform, arch) => withPlatform(platform, arch, () => resolveBundledPlatformDir(ext));

    check("win32-x64: exact match", platformDir("win32", "x64"), "win32-x64");
    check("win32-arm64: falls back to win32-x64 (runs under Prism)", platformDir("win32", "arm64"), "win32-x64");
    check("darwin-arm64: native build preferred over the x64 fallback", platformDir("darwin", "arm64"), "darwin-arm64");
    check("darwin-x64: nothing staged", platformDir("darwin", "x64"), undefined);
    check("linux-arm64: no emulation fallback on Linux", platformDir("linux", "arm64"), undefined);

    const bundled = path.join(ext, "bin", "linux-x64", "iverilog");
    fs.writeFileSync(bundled, "");
    const onPath = path.join(ext, "elsewhere");
    fs.mkdirSync(onPath);
    fs.writeFileSync(path.join(onPath, "vvp"), "");
    const realPath = process.env.PATH;
    process.env.PATH = ["", onPath].join(path.delimiter);
    try {
      withPlatform("linux", "x64", () => {
        check("override setting wins", resolveBinary(ext, "iverilog", " /custom/iverilog "), "/custom/iverilog");
        check("blank override is ignored; bundled copy is used", resolveBinary(ext, "iverilog", "  "), bundled);
        check("not bundled: found on PATH", resolveBinary(ext, "vvp", undefined), path.join(onPath, "vvp"));
        check("not anywhere: undefined", resolveBinary(ext, "verible-verilog-lint", undefined), undefined);
      });
    } finally {
      process.env.PATH = realPath;
    }
  })
);
