"use strict";
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const PROTOCOL = 1;

function instancesDir(env = process.env) {
  const state = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "pixel", "instances");
}

function instanceFile(tty, env = process.env) {
  return path.join(instancesDir(env), `${tty.replace(/[^\w-]/g, "_")}.json`);
}

class InstanceRecord {
  constructor(record, env = process.env) {
    this.record = { protocol: PROTOCOL, title: null, ...record };
    this.file = instanceFile(record.tty, env);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(this.record)}\n`);
      fs.renameSync(tmp, this.file);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
  }

  withdraw() {
    try {
      const current = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (current.pid !== this.record.pid) return;
    } catch {
      return;
    }
    fs.rmSync(this.file, { force: true });
  }
}

function lines(connection, onLine) {
  connection.setEncoding("utf8");
  let buffer = "";
  connection.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) onLine(line);
    }
  });
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Speaks the pixel owner protocol: one control connection per guest, plus one-shot
// info and a frame stream that must be acked frame by frame.
class OwnerServer {
  constructor({ socketPath, frameDir, handlers }) {
    this.socketPath = socketPath;
    this.frameDir = frameDir;
    this.handlers = handlers;
    this.control = null;
    this.greeted = false;
    this.queued = [];
    this.server = net.createServer((connection) => this.accept(connection));
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject);
        this.server.on("error", (error) => this.handlers.log("owner socket error", { error: error.message }));
        resolve();
      });
    });
  }

  accept(connection) {
    connection.on("error", () => {});
    let route = null;
    lines(connection, (line) => {
      if (route) return route(line);
      route = this.open(connection, parse(line));
    });
  }

  open(connection, opening) {
    const ignore = () => {};
    if (!opening) {
      connection.destroy();
      return ignore;
    }
    if (opening.method === "pane.graphics.info") {
      const cell = this.handlers.guestSize().cell;
      const result = {
        type: "pane_graphics_info",
        cell_width_px: cell[0],
        cell_height_px: cell[1],
        pane_visible: true,
        file_frame_directory: this.frameDir,
        file_frame_formats: ["rgba"],
        file_frame_transport: "direct-kitty",
      };
      connection.end(`${JSON.stringify({ id: opening.id ?? "info", result })}\n`);
      return ignore;
    }
    if (opening.method === "pane.graphics.stream") {
      const id = opening.id ?? "stream";
      connection.write(`${JSON.stringify({ id, result: { type: "ok" } })}\n`);
      const ack = `${JSON.stringify({ id, result: { type: "pane_graphics_frame_ack" } })}\n`;
      this.handlers.log("stream opened", { params: opening.params });
      return (line) => {
        const frame = parse(line);
        if (frame) this.handlers.onFrame(frame);
        connection.write(ack);
      };
    }
    if (opening.type === "announce") return ignore;
    if (opening.type === "join" && typeof opening.pane === "string") {
      this.control?.destroy();
      this.control = connection;
      this.greeted = false;
      connection.on("close", () => {
        if (this.control === connection) {
          this.control = null;
          this.handlers.onGuestClose();
        }
      });
      this.handlers.onJoin({ pane: opening.pane, name: opening.name, pid: opening.pid });
      return (line) => {
        const message = parse(line);
        if (message) this.handlers.onGuestMessage(message);
      };
    }
    connection.destroy();
    return ignore;
  }

  // The guest expects init before anything else, so other messages wait until it is sent.
  send(message) {
    if (!this.control) return;
    if (!this.greeted && message.type !== "init") {
      this.queued.push(message);
      return;
    }
    this.control.write(`${JSON.stringify(message)}\n`);
    if (message.type === "init") {
      this.greeted = true;
      for (const waiting of this.queued.splice(0)) this.send(waiting);
    }
  }

  close() {
    try {
      this.control?.destroy();
    } catch {}
    try {
      this.server.close();
    } catch {}
    fs.rmSync(this.socketPath, { force: true });
  }
}

module.exports = { PROTOCOL, InstanceRecord, OwnerServer, instancesDir, instanceFile };
