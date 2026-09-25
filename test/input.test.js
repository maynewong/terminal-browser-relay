"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { InputParser, mouseToGuest } = require("../src/input");

const feed = (text) => new InputParser().feed(Buffer.from(text, "latin1"));
const keys = (events) => events.map((e) => e.key);

test("plain text becomes key presses with text", () => {
  const events = new InputParser().feed(Buffer.from("aB€"));
  assert.deepEqual(keys(events), ["a", "B", "€"]);
  assert.equal(events[1].mods.shift, true);
  assert.equal(events[2].text, "€");
});

test("control bytes map to named keys and ctrl+letter", () => {
  const events = feed("\r\x7f\t\x01\x03");
  assert.deepEqual(keys(events), ["enter", "backspace", "tab", "a", "c"]);
  assert.equal(events[4].mods.ctrl, true);
});

test("ctrl+q quits", () => {
  assert.deepEqual(feed("x\x11").map((e) => e.type), ["key", "quit"]);
});

test("arrows, modified arrows, tilde keys, ss3 and shift+tab", () => {
  const events = feed("\x1b[A\x1b[1;5C\x1b[3~\x1b[5;2~\x1bOP\x1b[Z");
  assert.deepEqual(keys(events), ["up", "right", "delete", "pageup", "f1", "tab"]);
  assert.equal(events[1].mods.ctrl, true);
  assert.equal(events[3].mods.shift, true);
  assert.equal(events[5].mods.shift, true);
});

test("alt+letter arrives as escape prefix", () => {
  const [event] = feed("\x1bb");
  assert.equal(event.key, "b");
  assert.equal(event.mods.alt, true);
  assert.equal(event.text, undefined);
});

test("lone escape waits for flush", () => {
  const parser = new InputParser();
  assert.deepEqual(parser.feed(Buffer.from("\x1b")), []);
  assert.equal(parser.pending, true);
  assert.deepEqual(keys(parser.flush()), ["escape"]);
  assert.equal(parser.pending, false);
});

test("sequences split across reads are joined", () => {
  const parser = new InputParser();
  assert.deepEqual(parser.feed(Buffer.from("\x1b[<0;1")), []);
  const [event] = parser.feed(Buffer.from("0;5M"));
  assert.deepEqual(event, { type: "mouse-report", code: 0, x: 10, y: 5, release: false });
});

test("utf-8 split across reads is joined", () => {
  const parser = new InputParser();
  const bytes = Buffer.from("é");
  assert.deepEqual(parser.feed(bytes.subarray(0, 1)), []);
  assert.deepEqual(keys(parser.feed(bytes.subarray(1))), ["é"]);
});

test("bracketed paste becomes one paste event, even across reads", () => {
  const parser = new InputParser();
  assert.deepEqual(parser.feed(Buffer.from("\x1b[200~hello\x1b[A")), []);
  const events = parser.feed(Buffer.from(" world\x1b[201~z"));
  assert.deepEqual(events[0], { type: "paste", text: "hello\x1b[A world" });
  assert.equal(events[1].key, "z");
});

test("focus and terminal replies", () => {
  const events = feed("\x1b[I\x1b[O\x1b[6;20;10t\x1b_Gi=1;OK\x1b\\");
  assert.deepEqual(events[0], { type: "focus", focused: true });
  assert.deepEqual(events[1], { type: "focus", focused: false });
  assert.equal(events[2].type, "reply");
  assert.equal(events[3].type, "reply");
});

const size = { cols: 10, rows: 5, width: 50, height: 50, cell: [5, 10] };

test("cell mouse coordinates land on the cell center", () => {
  const message = mouseToGuest({ code: 0, x: 2, y: 3, release: false }, { pixelMouse: false, scale: 0.5, size });
  assert.deepEqual(message, { type: "mouse", kind: "down", button: "left", mods: { shift: false, alt: false, ctrl: false, super: false }, x: 7, y: 25 });
});

test("pixel mouse coordinates are scaled", () => {
  const message = mouseToGuest({ code: 2, x: 41, y: 21, release: true }, { pixelMouse: true, scale: 0.5, size });
  assert.equal(message.kind, "up");
  assert.equal(message.button, "right");
  assert.deepEqual([message.x, message.y], [20, 10]);
});

test("wheel, motion, modifiers and out-of-range", () => {
  const opts = { pixelMouse: false, scale: 1, size };
  assert.equal(mouseToGuest({ code: 64, x: 1, y: 1 }, opts).kind, "scrollup");
  assert.equal(mouseToGuest({ code: 65, x: 1, y: 1 }, opts).kind, "scrolldown");
  const move = mouseToGuest({ code: 32 + 16, x: 1, y: 1 }, opts);
  assert.equal(move.kind, "move");
  assert.equal(move.button, "none");
  assert.equal(move.mods.ctrl, true);
  assert.equal(mouseToGuest({ code: 0, x: 11, y: 1 }, opts), null);
});
