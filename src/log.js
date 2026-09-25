"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROTATE_BYTES = 5 * 1024 * 1024;

function createLogger(file) {
  let fd = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.statSync(file, { throwIfNoEntry: false })?.size > ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
    fd = fs.openSync(file, "a");
  } catch {}
  const log = (event, fields = {}) => {
    if (fd === null) return;
    try {
      fs.writeSync(fd, `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, event, ...fields })}\n`);
    } catch {}
  };
  log.file = file;
  return log;
}

module.exports = { createLogger };
