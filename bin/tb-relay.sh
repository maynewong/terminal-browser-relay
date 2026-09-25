#!/bin/sh
# Runs tb-relay.js on the Node runtime bundled inside terminal-browser's Electron, so the
# plugin needs no system Node. Falls back to `node` on PATH when that runtime is not found.
set -u

self="$0"
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname -- "$self")/$link" ;;
  esac
done
plugin_bin=$(CDPATH= cd -- "$(dirname -- "$self")" && pwd -P)
relay="$plugin_bin/tb-relay.js"

find_real_terminal_browser() {
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] || continue
    candidate="$dir/terminal-browser"
    [ -x "$candidate" ] && [ ! -d "$candidate" ] || continue
    resolved="$candidate"
    while [ -L "$resolved" ]; do
      link=$(readlink "$resolved")
      case "$link" in
        /*) resolved="$link" ;;
        *) resolved="$(dirname -- "$resolved")/$link" ;;
      esac
    done
    case "$(CDPATH= cd -- "$(dirname -- "$resolved")" && pwd -P)" in
      "$plugin_bin") continue ;;
    esac
    # The installer's PATH entry is a two-line shell shim that execs the real script.
    shim_target=$(sed -n 's/^exec "\(.*\/bin\/terminal-browser\)".*/\1/p' "$resolved" 2>/dev/null | head -n 1)
    if [ -n "$shim_target" ] && [ -x "$shim_target" ]; then
      resolved="$shim_target"
    fi
    IFS=$old_ifs
    printf '%s\n' "$resolved"
    return 0
  done
  IFS=$old_ifs
  return 1
}

runtime_under() {
  for exe in "$1/electron/terminal-browser.app/Contents/MacOS/terminal-browser" "$1/electron/pixel"; do
    if [ -x "$exe" ]; then
      printf '%s\n' "$exe"
      return 0
    fi
  done
  return 1
}

bundled_runtime() {
  if real=$(find_real_terminal_browser); then
    root=$(CDPATH= cd -- "$(dirname -- "$real")/.." && pwd -P) && runtime_under "$root" && return 0
  fi
  # The installer also records its root in <data dir>/terminal-browser*/install.
  for record in "${XDG_DATA_HOME:-$HOME/.local/share}"/terminal-browser*/install; do
    [ -f "$record" ] || continue
    root=$(head -n 1 "$record")
    [ -d "$root" ] && runtime_under "$root" && return 0
  done
  return 1
}

if runtime=$(bundled_runtime); then
  ELECTRON_RUN_AS_NODE=1 exec "$runtime" "$relay" "$@"
fi
if command -v node >/dev/null 2>&1; then
  exec node "$relay" "$@"
fi
echo "terminal-browser-relay: found neither terminal-browser's bundled runtime nor node on PATH" >&2
exit 127
