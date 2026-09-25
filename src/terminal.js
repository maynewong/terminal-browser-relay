"use strict";
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const EMPTY = Buffer.alloc(0);
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

const ENTER = "\x1b[?1049h\x1b[?25l\x1b[2J\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h";
const PIXEL_MOUSE_ON = "\x1b[?1016h";
const LEAVE = "\x1b[?1016l\x1b[?2004l\x1b[?1004l\x1b[?1006l\x1b[?1003l\x1b[?25h\x1b[?1049l";

function writeAll(data) {
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  let written = 0;
  while (written < bytes.length) {
    try {
      written += fs.writeSync(1, bytes, written);
    } catch (error) {
      if (error.code !== "EAGAIN") throw error;
      Atomics.wait(SLEEP_CELL, 0, 0, 2);
    }
  }
}

function ttyName() {
  return execFileSync("tty", { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8" }).trim();
}

function winsize() {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

function parseCellSize(text) {
  const m = /\x1b\[6;(\d+);(\d+)t/.exec(text);
  return m ? [Number(m[2]), Number(m[1])] : null;
}

function parseWindowSize(text, { cols, rows }) {
  const m = /\x1b\[4;(\d+);(\d+)t/.exec(text);
  if (!m || !cols || !rows) return null;
  const cell = [Math.floor(Number(m[2]) / cols), Math.floor(Number(m[1]) / rows)];
  return cell[0] > 0 && cell[1] > 0 ? cell : null;
}

function parseColors(text) {
  const colors = {};
  for (const [slot, name] of [["10", "foreground"], ["11", "background"]]) {
    const m = new RegExp(`\\x1b\\]${slot};rgb:([0-9a-fA-F]+)/([0-9a-fA-F]+)/([0-9a-fA-F]+)`).exec(text);
    if (m) colors[name] = [...m.slice(1, 4).map((part) => parseInt(part.slice(0, 2), 16)), 255];
  }
  return Object.keys(colors).length ? colors : null;
}

class Terminal {
  constructor() {
    this.sink = null;
    this.entered = false;
  }

  start(onData) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data) => (this.sink ?? onData)(data));
  }

  readReply(done, timeout = 400) {
    return new Promise((resolve) => {
      let buf = EMPTY;
      let timer;
      const finish = () => {
        clearTimeout(timer);
        this.sink = null;
        resolve(buf.toString("latin1"));
      };
      timer = setTimeout(finish, timeout);
      this.sink = (data) => {
        buf = Buffer.concat([buf, data]);
        clearTimeout(timer);
        if (done(buf.toString("latin1"))) return finish();
        timer = setTimeout(finish, timeout);
      };
    });
  }

  async query(sequence, done, timeout) {
    const reply = this.readReply(done, timeout);
    writeAll(sequence);
    return reply;
  }

  async cellSize() {
    const cell = parseCellSize(await this.query("\x1b[16t", (t) => /\x1b\[6;\d+;\d+t/.test(t)));
    if (cell) return cell;
    const window = parseWindowSize(await this.query("\x1b[14t", (t) => /\x1b\[4;\d+;\d+t/.test(t)), winsize());
    return window ?? [10, 20];
  }

  async colors() {
    return parseColors(await this.query("\x1b]10;?\x1b\\\x1b]11;?\x1b\\", (t) => t.split("rgb:").length > 2));
  }

  async supportsPixelMouse() {
    const reply = await this.query("\x1b[?1016$p", (t) => t.includes("$y"));
    return /\x1b\[\?1016;[12]\$y/.test(reply);
  }

  enter(pixelMouse) {
    this.entered = true;
    writeAll(ENTER + (pixelMouse ? PIXEL_MOUSE_ON : ""));
  }

  restore() {
    if (this.entered) {
      this.entered = false;
      try {
        writeAll(LEAVE);
      } catch {}
    }
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
  }
}

module.exports = { Terminal, writeAll, ttyName, winsize, parseCellSize, parseWindowSize, parseColors };
