"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULTS = Object.freeze({
  active_fps: 3,
  active_budget_mb_per_s: 0,
  idle_heartbeat_s: 5,
  idle_preview: true,
  target_cell_height: 26,
  scale: 0,
  tiny_change_rows: 0.03,
  active_ms: 3000,
  guest_fps: 15,
  join_timeout_s: 20,
  log: "",
});

function coerce(key, value) {
  const kind = typeof DEFAULTS[key];
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return !["0", "false", "no", "off", ""].includes(value.trim().toLowerCase());
    return undefined;
  }
  if (kind === "number") {
    const number = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function envOverrides(env) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const raw = env[`TBR_${key.toUpperCase()}`];
    if (raw === undefined) continue;
    const value = coerce(key, raw);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function mergeConfig(fileConfig, env) {
  const merged = { ...DEFAULTS };
  const unknown = [];
  for (const [key, raw] of Object.entries(fileConfig || {})) {
    if (!(key in DEFAULTS)) {
      unknown.push(key);
      continue;
    }
    const value = coerce(key, raw);
    if (value !== undefined) merged[key] = value;
  }
  return { config: { ...merged, ...envOverrides(env) }, unknown };
}

function configCandidates(explicit, env) {
  if (explicit) return [explicit];
  const candidates = [];
  if (env.HERDR_PLUGIN_CONFIG_DIR) candidates.push(path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.json"));
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  candidates.push(path.join(xdg, "terminal-browser-relay", "config.json"));
  return candidates;
}

function loadConfig({ explicit, env = process.env } = {}) {
  let file = null;
  let fileConfig = {};
  for (const candidate of configCandidates(explicit, env)) {
    if (!explicit && !fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, "utf8");
    try {
      fileConfig = JSON.parse(text);
    } catch (error) {
      throw new Error(`invalid JSON in ${candidate}: ${error.message}`);
    }
    file = candidate;
    break;
  }
  return { ...mergeConfig(fileConfig, env), file };
}

function defaultLogPath(env = process.env) {
  if (env.HERDR_PLUGIN_STATE_DIR) return path.join(env.HERDR_PLUGIN_STATE_DIR, "relay.log");
  const state = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "terminal-browser-relay", "relay.log");
}

module.exports = { DEFAULTS, mergeConfig, configCandidates, loadConfig, defaultLogPath };
