#!/usr/bin/env bash
# Stages Icarus Verilog (from Homebrew) into the veriscode
# extension's bundled bin/darwin-<arch>/ directory, using the same -B /
# IVERILOG_VPI_MODULE_PATH relocation trick as the Linux/Windows fetch
# scripts (see icarusRunner.ts) - Homebrew's iverilog also bakes in
# absolute paths to its support directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ARCH=$(uname -m)
case "$ARCH" in
  arm64) NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *) echo "error: unsupported macOS arch '$ARCH'" >&2; exit 1 ;;
esac

DEST="$REPO_ROOT/extensions/veriscode/bin/darwin-$NODE_ARCH"
LIB_DEST="$DEST/lib"

if ! command -v iverilog >/dev/null 2>&1; then
  echo "Installing Icarus Verilog via Homebrew..."
  brew install icarus-verilog
fi

mkdir -p "$DEST" "$LIB_DEST"

# `brew --prefix <formula>` is a symlink into the Cellar. Resolve it: `find`
# does not descend into a symlink it is given as a starting point, so
# searching the unresolved prefix finds nothing at all.
BREW_PREFIX=$(cd "$(brew --prefix icarus-verilog)" && pwd -P)
for bin in iverilog vvp iverilog-vpi; do
  src="$BREW_PREFIX/bin/$bin"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/"
    echo "Staged $bin from $src"
  else
    echo "Warning: $bin not found at $src" >&2
  fi
done

# Search by content (a .vpi module) rather than assuming where the support
# directory lives or what it is called.
SUPPORT_DIR=$(dirname "$(find "$BREW_PREFIX" -type f -name "*.vpi" 2>/dev/null | head -n1)")
if [[ -z "$SUPPORT_DIR" || "$SUPPORT_DIR" == "." ]]; then
  echo "error: could not find Icarus's .vpi support directory under $BREW_PREFIX" >&2
  exit 1
fi
cp -r "$SUPPORT_DIR/." "$LIB_DEST/"
echo "Staged support files from $SUPPORT_DIR"

echo "Icarus Verilog staged at $DEST"
ls -la "$DEST"

# For the record: any library the staged binaries load from outside the
# system (i.e. from Homebrew) would have to exist on the user's Mac too.
echo "Non-system libraries the staged binaries link against:"
otool -L "$DEST/iverilog" "$DEST/vvp" "$LIB_DEST"/ivl "$LIB_DEST"/ivlpp 2>/dev/null \
  | grep -v -e '^/' -e '/usr/lib/' -e '/System/' || echo "  (none)"
