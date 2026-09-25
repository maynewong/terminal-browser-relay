# Terminal Browser Relay

A herdr plugin that keeps [terminal-browser](https://github.com/zenbu-labs/terminal-browser) usable when you work on a remote machine over SSH.

## The problem

terminal-browser draws a real Chromium page into a terminal pane as pixels. Over SSH, herdr sends every frame to your laptop as raw RGBA: about 14 MB per frame for a half-screen pane on a HiDPI terminal, at up to display refresh rate. The link fills up and every other pane, including your agent's, stops responding.

## What the relay does

It sits between the browser and herdr, and forwards fewer, smaller frames:

- **Smaller.** The browser renders at about half the pixel density and the terminal stretches the image back. Text stays readable, just not sharp.
- **Fewer.** While you interact with the page, at most 3 frames per second. Otherwise a quarter-size preview every 5 seconds, and nothing if the page has not changed.

On a 35% pane that is 1.7 MB per frame while interacting instead of 5.9 MB, 0.4 MB every 5 seconds while idle, and zero for a static page.

Agents do not notice: `terminal-browser ls` and `terminal-browser action` keep working on the relayed browser.

## Who it is for

You run coding agents on a remote machine through herdr, want to see the pages they open, and would rather have a slightly blurry page than a frozen session. If you use herdr locally, you do not need this.

## Install

On the machine that runs the herdr server:

```bash
herdr plugin install maynewong/terminal-browser-relay
```

Requires terminal-browser 0.11 or newer there. Nothing else: the relay runs on the Node runtime bundled with terminal-browser.

## Use

- **Open a browser**: run the action `tb-relay.terminal-browser-relay.open-split` from the command palette, or bind it:

  ```toml
  [[keys.command]]
  key = "prefix+b"
  type = "plugin_action"
  command = "tb-relay.terminal-browser-relay.open-split"
  ```

  It splits the current pane, gives the browser 35% of the width and opens the start page.
- **Open a link**: Ctrl+click any `http(s)://` link in a pane.
- **Close**: Ctrl+Q in the browser pane. Every other key goes to the page.

Agents that run `terminal-browser open` themselves get a plain browser. To relay those too, install the optional PATH wrapper. It intercepts only `open` inside herdr, passes everything else to the real binary, and affects every agent of your user on that machine:

```bash
scripts/install-wrapper.sh      # adds a `terminal-browser` shim to ~/.local/bin
scripts/uninstall-wrapper.sh
```

## How it works

1. The relay is the foreground process of the browser pane and registers as the pixel owner of that pane's tty.
2. terminal-browser finds the owner and starts in hosted mode: it renders at the size the relay asks for and hands each frame over as a file, waiting for an ack before reusing it.
3. The relay acks at once, drops what it will not send, and sends based on your input, page title changes and a heartbeat.
4. Frames reach herdr as standard kitty graphics on the pane's pty, through temporary files that herdr deletes after reading. Keys, mouse and paste go the other way.

The relay never uses herdr's `pane.graphics.*` API, only kitty graphics and the stable CLI, so it works with herdr 0.9 and with herdr main, where that API was removed.

## Trade-offs

- **Sharpness for bandwidth.** Pages render at about 26 px cell height, half resolution on a HiDPI terminal.
- **Liveness for other panes.** Animation freezes between heartbeats unless you interact with the page. Hovering does not count.
- **Whole frames only.** herdr forwards each frame as a complete raw image. The relay can send fewer and smaller frames, not compressed or partial ones.
- **An internal dependency.** Hosted mode is how terminal-browser talks to its own owner processes, not a public API. If an upgrade breaks it, the relay notices within 20 seconds and opens a plain browser instead.

## Configuration

Optional. Put a `config.json` in the directory printed by `herdr plugin config-dir tb-relay.terminal-browser-relay`, or set `TBR_<KEY>` in the environment.

| Key | Default | Effect |
| --- | --- | --- |
| `active_fps` | `3` | Frames per second while you interact |
| `idle_heartbeat_s` | `5` | Seconds between idle previews |
| `idle_preview` | `true` | Idle frames at quarter size |
| `target_cell_height` | `26` | Render density; lower is smaller and blurrier |
| `active_budget_mb_per_s` | off | Bytes-per-second cap instead of `active_fps` |

Logs: one JSON line per event in the plugin state directory, with a stats line every 5 seconds while frames flow.

## Development

`npm test` runs the unit tests. No dependencies.

## License

MIT
