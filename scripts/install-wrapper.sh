#!/bin/sh
# Links the opt-in terminal-browser wrapper into a directory on PATH (default ~/.local/bin).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
wrapper="$root/bin/terminal-browser"
dir="${1:-$HOME/.local/bin}"
target="$dir/terminal-browser"

mkdir -p "$dir"
if [ -L "$target" ] && [ "$(readlink "$target")" = "$wrapper" ]; then
  echo "already installed: $target -> $wrapper"
  exit 0
fi
if [ -e "$target" ] || [ -L "$target" ]; then
  echo "refusing to replace $target (it is not this wrapper; the real terminal-browser may live there)." >&2
  echo "pass a directory that comes earlier on PATH, for example:" >&2
  echo "  mkdir -p ~/.local/share/terminal-browser-relay/bin" >&2
  echo "  $0 ~/.local/share/terminal-browser-relay/bin" >&2
  echo "  and put that directory first on PATH in your shell profile" >&2
  exit 1
fi
ln -s "$wrapper" "$target"
echo "installed: $target -> $wrapper"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "note: $dir is not on PATH yet" ;;
esac
resolved=$(command -v terminal-browser || true)
if [ "$resolved" != "$target" ]; then
  echo "note: terminal-browser currently resolves to $resolved; put $dir earlier on PATH for the wrapper to take effect"
fi
