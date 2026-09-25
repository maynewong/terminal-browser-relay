"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { shellQuote, relayCommand, splitPaneId, resolveTarget } = require("../src/launch");
const { parseVersion, atLeast } = require("../src/guest");
const { instanceFile } = require("../src/owner");

test("shell quoting survives single quotes", () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("relay command carries plugin dirs and the url", () => {
  const command = relayCommand({ url: "https://a.b/?q=1&x='y'", env: { HERDR_PLUGIN_STATE_DIR: "/s d" }, launcher: "/p lug/bin/tb-relay.sh" });
  assert.match(command, /^HERDR_PLUGIN_STATE_DIR='\/s d' exec sh '\/p lug\/bin\/tb-relay\.sh' open 'https:\/\/a\.b\/\?q=1&x='\\''y'\\'''$/);
  assert.match(relayCommand({ env: {} }), /bin\/tb-relay\.sh' open$/);
});

test("split output parsing", () => {
  assert.equal(splitPaneId('{"id":"cli:pane:split","result":{"pane":{"pane_id":"w1:p9"},"type":"pane_info"}}'), "w1:p9");
  assert.throws(() => splitPaneId('{"result":{}}'));
});

test("local paths resolve against the caller cwd, urls stay as they are", () => {
  assert.equal(resolveTarget("package.json", `${__dirname}/..`), require("node:path").resolve(__dirname, "..", "package.json"));
  assert.equal(resolveTarget("https://example.com", "/"), "https://example.com");
  assert.equal(resolveTarget("example.com", "/"), "example.com");
});

test("version gate", () => {
  assert.deepEqual(parseVersion("terminal-browser v0.11.1\n"), [0, 11, 1]);
  assert.equal(atLeast([0, 11, 1], [0, 11, 0]), true);
  assert.equal(atLeast([0, 10, 9], [0, 11, 0]), false);
  assert.equal(atLeast([1, 0, 0], [0, 11, 0]), true);
});

test("instance record file name matches pixel", () => {
  assert.equal(instanceFile("/dev/ttys012", { XDG_STATE_HOME: "/st" }), "/st/pixel/instances/_dev_ttys012.json");
});
