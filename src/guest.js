"use strict";
const { spawnSync } = require("node:child_process");

const MIN_VERSION = [0, 11, 0];

function guestEnv(env, extra = {}) {
  const out = { ...env, TBR_PASSTHROUGH: "1", ...extra };
  delete out.PIXEL_PANE;
  return out;
}

function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text || "");
  return m ? m.slice(1, 4).map(Number) : null;
}

function atLeast(version, minimum) {
  for (let i = 0; i < minimum.length; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

function checkTerminalBrowser(env = process.env) {
  const result = spawnSync("terminal-browser", ["--version"], { env: guestEnv(env), encoding: "utf8", timeout: 10000 });
  if (result.error) return { ok: false, reason: `terminal-browser not runnable (${result.error.code || result.error.message})` };
  const version = parseVersion(result.stdout || result.stderr);
  if (!version) return { ok: false, reason: "could not read terminal-browser --version" };
  if (!atLeast(version, MIN_VERSION)) {
    return { ok: false, reason: `terminal-browser ${version.join(".")} is older than ${MIN_VERSION.join(".")}` };
  }
  return { ok: true, version: version.join(".") };
}

module.exports = { MIN_VERSION, guestEnv, parseVersion, atLeast, checkTerminalBrowser };
