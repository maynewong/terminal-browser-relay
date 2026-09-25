"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const IMAGE_ID = 0x7e51;
// Kitty (and herdr) only delete a temporary-file upload when its name contains this marker.
const TEMP_MARKER = "tty-graphics-protocol";

function tempPrefix(pid = process.pid) {
  return `${TEMP_MARKER}-tb-relay-${pid}-`;
}

function writeTempFrame(pixels, counter) {
  const file = path.join(os.tmpdir(), `${tempPrefix()}${counter}.rgba`);
  fs.writeFileSync(file, pixels);
  return file;
}

function placeCommand({ file, width, height, cols, rows }) {
  const payload = Buffer.from(file).toString("base64");
  return `\x1b[H\x1b_Ga=T,f=32,t=t,s=${width},v=${height},i=${IMAGE_ID},c=${cols},r=${rows},C=1,q=2;${payload}\x1b\\`;
}

function deleteCommand() {
  return `\x1b_Ga=d,d=I,i=${IMAGE_ID},q=2\x1b\\`;
}

function sweepTempFrames() {
  const prefix = tempPrefix();
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (name.startsWith(prefix)) fs.rmSync(path.join(os.tmpdir(), name), { force: true });
    }
  } catch {}
}

module.exports = { IMAGE_ID, writeTempFrame, placeCommand, deleteCommand, sweepTempFrames };
