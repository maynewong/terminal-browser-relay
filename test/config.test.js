"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DEFAULTS, mergeConfig, configCandidates, loadConfig, defaultLogPath } = require("../src/config");

test("defaults when nothing is set", () => {
  assert.deepEqual(mergeConfig({}, {}).config, DEFAULTS);
});

test("file values apply, invalid ones are ignored, unknown keys reported", () => {
  const { config, unknown } = mergeConfig({ active_fps: 5, idle_heartbeat_s: "x", idle_preview: false, bogus: 1 }, {});
  assert.equal(config.active_fps, 5);
  assert.equal(config.idle_heartbeat_s, DEFAULTS.idle_heartbeat_s);
  assert.equal(config.idle_preview, false);
  assert.deepEqual(unknown, ["bogus"]);
});

test("TBR_ env overrides the file", () => {
  const { config } = mergeConfig({ active_fps: 5, scale: 0.8 }, { TBR_ACTIVE_FPS: "2", TBR_IDLE_PREVIEW: "0", TBR_LOG: "/tmp/x.log", TBR_SCALE: "" });
  assert.equal(config.active_fps, 2);
  assert.equal(config.idle_preview, false);
  assert.equal(config.log, "/tmp/x.log");
  assert.equal(config.scale, 0.8);
});

test("config file resolution order", () => {
  assert.deepEqual(configCandidates("/a.json", { HERDR_PLUGIN_CONFIG_DIR: "/p" }), ["/a.json"]);
  assert.deepEqual(configCandidates(undefined, { HERDR_PLUGIN_CONFIG_DIR: "/p", XDG_CONFIG_HOME: "/x" }), [
    "/p/config.json",
    "/x/terminal-browser-relay/config.json",
  ]);
});

test("loadConfig picks the first existing file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tbr-config-"));
  try {
    fs.mkdirSync(path.join(dir, "xdg", "terminal-browser-relay"), { recursive: true });
    fs.writeFileSync(path.join(dir, "xdg", "terminal-browser-relay", "config.json"), '{"active_fps": 7}');
    const env = { HERDR_PLUGIN_CONFIG_DIR: path.join(dir, "missing"), XDG_CONFIG_HOME: path.join(dir, "xdg") };
    const loaded = loadConfig({ env });
    assert.equal(loaded.config.active_fps, 7);
    assert.equal(loaded.file, path.join(dir, "xdg", "terminal-browser-relay", "config.json"));
    fs.mkdirSync(env.HERDR_PLUGIN_CONFIG_DIR);
    fs.writeFileSync(path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.json"), '{"active_fps": 1}');
    assert.equal(loadConfig({ env }).config.active_fps, 1);
    assert.throws(() => loadConfig({ explicit: path.join(dir, "nope.json"), env }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("default log path prefers the plugin state dir", () => {
  assert.equal(defaultLogPath({ HERDR_PLUGIN_STATE_DIR: "/s" }), "/s/relay.log");
  assert.equal(defaultLogPath({ XDG_STATE_HOME: "/x" }), "/x/terminal-browser-relay/relay.log");
});
