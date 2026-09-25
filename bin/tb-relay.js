#!/usr/bin/env node
"use strict";
const path = require("node:path");
const { spawn } = require("node:child_process");

const { loadConfig, defaultLogPath } = require("../src/config");
const { createLogger } = require("../src/log");
const launch = require("../src/launch");

const USAGE = `Usage:
  tb-relay open [url] [--config <path>]   run the relay in this pane (foreground)
  tb-relay split [url] [--pane <id>] [--direction right|down] [--size <browser share>] [--wait]
                                          split a herdr pane and run the relay in the new pane
  tb-relay route-open <terminal-browser open args...>
                                          used by the terminal-browser PATH wrapper
`;

function fail(message) {
  process.stderr.write(`tb-relay: ${message}\n`);
  process.exit(1);
}

function takeFlag(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined) fail(`${name} requires a value`);
  args.splice(at, 2);
  return value;
}

function takeBool(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
}

function positional(args) {
  const rest = args.filter((arg) => !arg.startsWith("-"));
  if (rest.length > 1) fail(`unexpected argument ${rest[1]}`);
  return rest[0];
}

function parseShare(raw) {
  if (raw === undefined) return launch.BROWSER_SHARE;
  const share = Number(raw);
  if (!(share >= 0.2 && share <= 0.95)) fail(`invalid --size ${raw} (fraction between 0.2 and 0.95)`);
  return share;
}

function parseDirection(raw) {
  if (raw === undefined || raw === null) return "right";
  if (raw === "right" || raw === "left") return "right";
  if (raw === "down" || raw === "up") return "down";
  fail(`invalid direction ${raw} (right or down)`);
}

async function openCommand(args) {
  const explicit = takeFlag(args, "--config");
  const url = positional(args) || process.env.TBR_URL || process.env.HERDR_PLUGIN_CLICKED_URL || undefined;
  let loaded;
  try {
    loaded = loadConfig({ explicit });
  } catch (error) {
    fail(error.message);
  }
  const log = createLogger(loaded.config.log || defaultLogPath());
  if (loaded.unknown.length) log("config unknown keys", { file: loaded.file, keys: loaded.unknown });
  const { Relay } = require("../src/relay");
  await new Relay({ url, config: loaded.config, log }).run();
}

async function splitCommand(args, { wait } = {}) {
  const pane = takeFlag(args, "--pane");
  const direction = parseDirection(takeFlag(args, "--direction"));
  const share = parseShare(takeFlag(args, "--size"));
  const shouldWait = takeBool(args, "--wait") || wait;
  const url = positional(args) || process.env.HERDR_PLUGIN_CLICKED_URL || undefined;
  const before = shouldWait ? new Set(launch.listBrowsers(process.env).map(launch.browserKey)) : null;
  let created;
  try {
    created = launch.openSplit({ url, pane, direction, share });
  } catch (error) {
    fail(error.message);
  }
  if (!shouldWait) {
    process.stdout.write(`${JSON.stringify({ pane: created })}\n`);
    return;
  }
  const browser = await launch.waitForBrowser({ pane: created, before });
  if (!browser) fail(`browser did not register within 25s (relay pane ${created}; see its log)`);
  process.stdout.write(`${JSON.stringify(browser, null, 2)}\n`);
}

function passthrough(args) {
  const real = process.env.TBR_REAL_TERMINAL_BROWSER || "terminal-browser";
  const child = spawn(real, args, { stdio: "inherit", env: { ...process.env, TBR_PASSTHROUGH: "1" } });
  child.on("error", (error) => fail(`could not run ${real}: ${error.message}`));
  child.on("exit", (code) => process.exit(code ?? 1));
}

// `terminal-browser open ...` from the PATH wrapper. Like the real `open`, `--split` merges into the
// browser already in this tab; otherwise the relay runs in place for a shell, or in a new split.
async function routeOpen(args) {
  if (args.some((arg) => arg === "--ssh" || arg.startsWith("--ssh="))) return passthrough(["open", ...args]);
  const noMerge = takeBool(args, "--no-merge") || process.env.TERMINAL_BROWSER_NO_MERGE === "1";
  const splitFlag = takeFlag(args, "--split");
  const size = takeFlag(args, "--size");
  if (splitFlag !== undefined && !noMerge) {
    const here = launch.listBrowsers(process.env).filter((browser) => browser.inCurrentTab);
    if (here.length === 1) {
      const url = positional(args);
      return passthrough(["new-tab", ...(url ? [launch.resolveTarget(url, process.cwd())] : [])]);
    }
  }
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (splitFlag === undefined && interactive) return openCommand(args);
  const forwarded = [...args, "--wait"];
  if (splitFlag !== undefined) forwarded.push("--direction", splitFlag);
  if (size !== undefined) forwarded.push("--size", size);
  return splitCommand(forwarded);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "open") return openCommand(args);
  if (command === "split") return splitCommand(args);
  if (command === "route-open") return routeOpen(args);
  if (command === "--version" || command === "version") {
    process.stdout.write(`${require(path.join(__dirname, "..", "package.json")).version}\n`);
    return;
  }
  process.stdout.write(USAGE);
  process.exit(command === undefined || command === "help" || command === "--help" ? 0 : 1);
}

main().catch((error) => fail(error.stack || error.message));
