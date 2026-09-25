"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { Terminal, writeAll, ttyName, winsize } = require("./terminal");
const { InputParser, mouseToGuest } = require("./input");
const { InstanceRecord, OwnerServer } = require("./owner");
const { Scheduler } = require("./scheduler");
const { halve, changedRowFraction } = require("./pixels");
const kitty = require("./kitty");
const { guestEnv, checkTerminalBrowser } = require("./guest");

const STATS_INTERVAL_MS = 5000;
const ESCAPE_WAIT_MS = 50;
const MIN_SCALE = 0.35;

function autoScale(cellHeight, target) {
  return Math.min(1, Math.max(MIN_SCALE, target / cellHeight));
}

function average(values) {
  return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : null;
}

class Relay {
  constructor({ url, config, log }) {
    this.url = url;
    this.config = config;
    this.log = log;
    this.terminal = new Terminal();
    this.parser = new InputParser();
    this.scheduler = new Scheduler(config);
    this.cell = [10, 20];
    this.scale = 1;
    this.pixelMouse = false;
    this.colors = null;
    this.server = null;
    this.record = null;
    this.child = null;
    this.joined = false;
    this.stopping = false;
    this.latest = null;
    this.lastSent = null;
    this.pending = false;
    this.sendTimer = null;
    this.escapeTimer = null;
    this.joinTimer = null;
    this.sizeSent = null;
    this.title = null;
    this.tempCounter = 0;
    this.stats = { received: 0, sent: 0, previews: 0, dropped: 0, skippedSame: 0, skippedTiny: 0, bytesSent: 0, copyMs: [], previewMs: [] };
    this.totals = { received: 0, sent: 0, previews: 0, bytesSent: 0 };
  }

  guestSize() {
    const { cols, rows } = winsize();
    const cellW = Math.max(1, Math.round(this.cell[0] * this.scale));
    const cellH = Math.max(1, Math.round(this.cell[1] * this.scale));
    return {
      cols,
      rows,
      width: Math.round(cols * this.cell[0] * this.scale),
      height: Math.round(rows * this.cell[1] * this.scale),
      cell: [cellW, cellH],
    };
  }

  async run() {
    const check = checkTerminalBrowser();
    if (!check.ok) return this.fallback(check.reason);

    const tty = ttyName();
    this.terminal.start((data) => this.onInput(data));
    this.cell = await this.terminal.cellSize();
    this.scale = this.config.scale > 0 ? this.config.scale : autoScale(this.cell[1], this.config.target_cell_height);
    this.colors = await this.terminal.colors();
    this.pixelMouse = await this.terminal.supportsPixelMouse();
    this.terminal.enter(this.pixelMouse);

    this.frameDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-relay-frames-"));
    this.socketPath = path.join(os.tmpdir(), `tb-relay-${process.pid}.sock`);
    this.server = new OwnerServer({
      socketPath: this.socketPath,
      frameDir: this.frameDir,
      handlers: {
        log: this.log,
        guestSize: () => this.guestSize(),
        onFrame: (frame) => this.onFrame(frame),
        onJoin: (guest) => this.onJoin(guest),
        onGuestMessage: (message) => this.onGuestMessage(message),
        onGuestClose: () => this.stop("guest closed its control connection"),
      },
    });
    await this.server.listen();
    this.record = new InstanceRecord({
      tty,
      pid: process.pid,
      socket: this.socketPath,
      name: "tb-relay",
      cwd: process.cwd(),
      startedAt: Date.now(),
    });
    this.log("start", {
      tty,
      url: this.url,
      terminalBrowser: check.version,
      cell: this.cell,
      scale: this.scale,
      pixelMouse: this.pixelMouse,
      size: this.guestSize(),
      config: this.config,
    });

    this.spawnGuest(tty);
    this.joinTimer = setTimeout(() => this.fallback(`no guest joined within ${this.config.join_timeout_s}s`), this.config.join_timeout_s * 1000);

    this.onStdoutResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.onResize(), 100);
    };
    process.stdout.on("resize", this.onStdoutResize);
    this.statsTimer = setInterval(() => this.logStats(), STATS_INTERVAL_MS);
    this.statsTimer.unref();
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => this.stop(signal));
    process.on("uncaughtException", (error) => this.stop("uncaught exception", error));
  }

  spawnGuest(tty) {
    const args = ["open", ...(this.url ? [this.url] : [])];
    const out = fs.openSync(path.join(path.dirname(this.log.file), "guest.log"), "a");
    this.child = spawn("terminal-browser", args, {
      env: guestEnv(process.env, { PIXEL_TTY: tty, PIXEL_FPS: String(this.config.guest_fps) }),
      stdio: ["ignore", out, out],
      detached: true,
    });
    fs.closeSync(out);
    this.child.on("error", (error) => this.log("guest spawn error", { error: error.message }));
    this.child.on("exit", (code, signal) => {
      this.log("guest exited", { code, signal });
      if (this.stopping) return;
      if (!this.joined) this.fallback(`terminal-browser exited (code ${code}) before joining`);
      else this.stop("guest exited");
    });
  }

  onJoin(guest) {
    this.joined = true;
    clearTimeout(this.joinTimer);
    this.log("guest joined", { guestPane: guest.pane, guestName: guest.name, guestPid: guest.pid });
    const size = this.guestSize();
    this.sizeSent = size;
    this.server.send({ type: "init", ...size, colors: this.colors, focused: true });
  }

  onGuestMessage(message) {
    if (message.type === "title" && typeof message.text === "string") {
      writeAll(`\x1b]2;${message.text}\x1b\\`);
      if (message.text !== this.title) {
        this.title = message.text;
        const wasActive = this.scheduler.isActive(Date.now());
        this.scheduler.noteTitleChange(Date.now());
        if (!wasActive) this.log("active", { reason: "title changed" });
        this.wake();
      }
    } else if (message.type === "pointer" && message.shape) {
      writeAll(`\x1b]22;${message.shape}\x1b\\`);
    } else if (message.type === "clipboard" && typeof message.text === "string") {
      writeAll(`\x1b]52;c;${Buffer.from(message.text).toString("base64")}\x1b\\`);
    } else if (message.type !== "placed") {
      this.log("guest message", { type: message.type });
    }
  }

  onFrame(frame) {
    this.stats.received++;
    const file = frame.file?.path;
    if (!file || !frame.image_width || !frame.image_height) return;
    const started = process.hrtime.bigint();
    let pixels;
    try {
      pixels = fs.readFileSync(file);
    } catch (error) {
      this.log("frame read failed", { error: error.message });
      return;
    }
    this.stats.copyMs.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (pixels.length < frame.image_width * frame.image_height * 4) return;
    if (this.pending) this.stats.dropped++;
    this.latest = { pixels, width: frame.image_width, height: frame.image_height };
    this.pending = true;
    this.schedule();
  }

  // After a blurry idle preview, the next active moment should repaint at full size even if nothing changed.
  wake() {
    if (this.latest && this.scheduler.lastWasPreview) this.pending = true;
    this.schedule();
  }

  schedule() {
    clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (!this.pending || this.stopping) return;
    const { delay } = this.scheduler.nextCheck(Date.now());
    this.sendTimer = setTimeout(() => this.evaluate(), delay);
  }

  evaluate() {
    this.sendTimer = null;
    if (!this.pending || this.stopping) return;
    const now = Date.now();
    const { mode, delay } = this.scheduler.nextCheck(now);
    if (delay > 0) return this.schedule();
    const decision = this.scheduler.decide(now, changedRowFraction(this.lastSent, this.latest), mode);
    if (decision.action === "skip-same") {
      this.pending = false;
      this.stats.skippedSame++;
    } else if (decision.action === "defer") {
      this.stats.skippedTiny++;
      this.sendTimer = setTimeout(() => this.evaluate(), decision.delay);
    } else {
      this.emit(decision.mode === "preview");
    }
  }

  emit(preview) {
    const frame = this.latest;
    let out = frame;
    if (preview) {
      const started = process.hrtime.bigint();
      out = halve(frame.pixels, frame.width, frame.height);
      this.stats.previewMs.push(Number(process.hrtime.bigint() - started) / 1e6);
      this.stats.previews++;
    }
    const { cols, rows } = winsize();
    const file = kitty.writeTempFrame(out.pixels, this.tempCounter++);
    writeAll(kitty.placeCommand({ file, width: out.width, height: out.height, cols, rows }));
    this.lastSent = frame;
    this.pending = false;
    this.scheduler.recordSent(Date.now(), out.pixels.length, preview);
    this.stats.sent++;
    this.stats.bytesSent += out.pixels.length;
  }

  onInput(data) {
    clearTimeout(this.escapeTimer);
    this.dispatch(this.parser.feed(data));
    if (this.parser.pending) {
      this.escapeTimer = setTimeout(() => this.dispatch(this.parser.flush()), ESCAPE_WAIT_MS);
    }
  }

  dispatch(events) {
    for (const event of events) {
      if (event.type === "quit") return this.stop("ctrl+q");
      if (event.type === "reply") continue;
      if (event.type === "focus") {
        this.server?.send(event);
        continue;
      }
      let message = event;
      if (event.type === "mouse-report") {
        message = mouseToGuest(event, { pixelMouse: this.pixelMouse, scale: this.scale, size: this.guestSize() });
        if (!message) continue;
      }
      const hover = message.type === "mouse" && message.kind === "move";
      if (!hover && this.scheduler.noteInput(Date.now())) {
        this.log("active", { reason: message.type === "mouse" ? `mouse ${message.kind}` : message.type });
        this.wake();
      }
      this.server?.send(message);
    }
  }

  onResize() {
    const size = this.guestSize();
    if (this.sizeSent && size.cols === this.sizeSent.cols && size.rows === this.sizeSent.rows) return;
    this.sizeSent = size;
    writeAll("\x1b[2J");
    this.server?.send({ type: "size", ...size });
    this.log("resize", size);
  }

  logStats() {
    const s = this.stats;
    for (const key of Object.keys(this.totals)) this.totals[key] += s[key];
    if (s.received === 0 && s.sent === 0) return;
    this.log("stats", {
      active: this.scheduler.isActive(Date.now()),
      received: s.received,
      sent: s.sent,
      previews: s.previews,
      dropped: s.dropped,
      skippedSame: s.skippedSame,
      skippedTiny: s.skippedTiny,
      sentMB: Number((s.bytesSent / 1e6).toFixed(2)),
      copyMsAvg: average(s.copyMs),
      previewMsAvg: average(s.previewMs),
    });
    this.stats = { received: 0, sent: 0, previews: 0, dropped: 0, skippedSame: 0, skippedTiny: 0, bytesSent: 0, copyMs: [], previewMs: [] };
  }

  cleanup() {
    if (this.onStdoutResize) process.stdout.off("resize", this.onStdoutResize);
    clearTimeout(this.resizeTimer);
    clearInterval(this.statsTimer);
    clearTimeout(this.sendTimer);
    clearTimeout(this.joinTimer);
    clearTimeout(this.escapeTimer);
    this.record?.withdraw();
    this.server?.close();
    if (this.terminal.entered) writeAll(kitty.deleteCommand());
    this.terminal.restore();
    kitty.sweepTempFrames();
    if (this.frameDir) fs.rmSync(this.frameDir, { recursive: true, force: true });
  }

  killGuest(signal) {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      try {
        this.child.kill(signal);
      } catch {}
    }
  }

  stop(reason, error) {
    if (this.stopping) return;
    this.stopping = true;
    this.logStats();
    this.log("stop", { reason, error: error ? String(error.stack || error) : undefined, totals: this.totals });
    this.cleanup();
    const alive = this.child && this.child.exitCode === null && this.child.signalCode === null;
    if (!alive) return process.exit(error ? 1 : 0);
    this.child.once("exit", () => process.exit(error ? 1 : 0));
    setTimeout(() => this.killGuest("SIGTERM"), 1500).unref();
    setTimeout(() => process.exit(error ? 1 : 0), 3000).unref();
  }

  // Runs plain terminal-browser in this pane, the same way it would run without the relay.
  fallback(reason) {
    if (this.stopping) return;
    this.stopping = true;
    this.log("fallback", { reason });
    this.killGuest("SIGTERM");
    this.cleanup();
    process.stderr.write(`terminal-browser-relay: ${reason}; opening terminal-browser directly\n`);
    const args = ["open", ...(this.url ? [this.url] : [])];
    const env = guestEnv(process.env);
    delete env.PIXEL_TTY;
    const plain = spawn("terminal-browser", args, { env, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => plain.kill(signal));
    plain.on("error", (error) => {
      process.stderr.write(`terminal-browser-relay: could not start terminal-browser: ${error.message}\n`);
      process.exit(1);
    });
    plain.on("exit", (code) => process.exit(code ?? 1));
  }
}

module.exports = { Relay, autoScale };
