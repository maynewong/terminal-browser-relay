"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BROWSER_SHARE = 0.35;
const REGISTER_TIMEOUT_MS = 25000;
const RELAY_LAUNCHER = path.join(__dirname, "..", "bin", "tb-relay.sh");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveTarget(url, cwd) {
  if (!url) return url;
  const local = path.resolve(cwd, url);
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && fs.existsSync(local) ? local : url;
}

// Plugin dirs are only in the action's environment, so they are carried into the new pane's command.
function relayCommand({ url, env, launcher = RELAY_LAUNCHER }) {
  const vars = ["HERDR_PLUGIN_CONFIG_DIR", "HERDR_PLUGIN_STATE_DIR"]
    .filter((name) => env[name])
    .map((name) => `${name}=${shellQuote(env[name])} `)
    .join("");
  const target = url ? ` ${shellQuote(url)}` : "";
  return `${vars}exec sh ${shellQuote(launcher)} open${target}`;
}

function herdr(env, args) {
  const bin = env.HERDR_BIN_PATH || "herdr";
  const result = spawnSync(bin, args, { env, encoding: "utf8" });
  if (result.error) throw new Error(`could not run ${bin}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`herdr ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function splitPaneId(output) {
  const parsed = JSON.parse(output);
  const id = parsed?.result?.pane?.pane_id;
  if (!id) throw new Error(`unexpected herdr pane split output: ${output.trim().slice(0, 200)}`);
  return id;
}

// herdr's --ratio is the share the original pane keeps, so the browser share is inverted.
function openSplit({ url, pane, direction = "right", share = BROWSER_SHARE, cwd = process.cwd(), env = process.env }) {
  const from = pane || env.HERDR_PANE_ID;
  if (!from) throw new Error("no pane to split: run inside herdr (HERDR_PANE_ID is unset)");
  const ratio = String(Number((1 - share).toFixed(3)));
  const created = splitPaneId(
    herdr(env, ["pane", "split", from, "--direction", direction, "--ratio", ratio, "--cwd", cwd, "--no-focus"]),
  );
  herdr(env, ["pane", "run", created, relayCommand({ url: resolveTarget(url, cwd), env })]);
  return created;
}

function listBrowsers(env) {
  const result = spawnSync("terminal-browser", ["ls", "--all", "--json"], {
    env: { ...env, TBR_PASSTHROUGH: "1" },
    encoding: "utf8",
  });
  try {
    return JSON.parse(result.stdout).browsers || [];
  } catch {
    return [];
  }
}

function browserKey(browser) {
  return String(browser.key ?? browser.pid);
}

async function waitForBrowser({ pane, before, env = process.env, timeout = REGISTER_TIMEOUT_MS }) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = listBrowsers(env).find((browser) => browser.pane?.pane === pane || !before.has(browserKey(browser)));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

module.exports = { BROWSER_SHARE, shellQuote, resolveTarget, relayCommand, splitPaneId, openSplit, listBrowsers, browserKey, waitForBrowser };
