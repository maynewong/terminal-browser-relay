#!/bin/sh
# Removes the wrapper link created by install-wrapper.sh, leaving the real terminal-browser alone.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
wrapper="$root/bin/terminal-browser"
dir="${1:-$HOME/.local/bin}"
target="$dir/terminal-browser"

if [ -L "$target" ] && [ "$(readlink "$target")" = "$wrapper" ]; then
  rm "$target"
  echo "removed: $target"
else
  echo "no wrapper link at $target; nothing to do"
fi
