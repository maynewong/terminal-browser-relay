"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Scheduler } = require("../src/scheduler");
const { DEFAULTS } = require("../src/config");

const make = (overrides = {}) => new Scheduler({ ...DEFAULTS, ...overrides });

test("idle until input, active for active_ms after it", () => {
  const s = make();
  assert.equal(s.isActive(10_000), false);
  assert.equal(s.noteInput(10_000), true);
  assert.equal(s.noteInput(10_500), false);
  assert.equal(s.isActive(13_499), true);
  assert.equal(s.isActive(13_500), false);
});

test("title change opens a short burst", () => {
  const s = make();
  s.noteTitleChange(1000);
  assert.equal(s.isActive(2400), true);
  assert.equal(s.isActive(2600), false);
});

test("active mode caps at active_fps", () => {
  const s = make({ active_fps: 4 });
  s.noteInput(0);
  assert.deepEqual(s.nextCheck(100), { delay: 0, mode: "full" });
  s.recordSent(100, 1000, false);
  assert.deepEqual(s.nextCheck(150), { delay: 200, mode: "full" });
});

test("byte budget replaces the fps cap", () => {
  const s = make({ active_fps: 30, active_budget_mb_per_s: 2 });
  s.noteInput(0);
  s.recordSent(0, 1_000_000, false);
  assert.equal(s.nextCheck(100).delay, 400);
});

test("idle mode waits for the heartbeat and sends a preview", () => {
  const s = make({ idle_heartbeat_s: 5 });
  s.recordSent(0, 100, false);
  assert.deepEqual(s.nextCheck(1000), { delay: 4000, mode: "preview" });
  assert.equal(make({ idle_preview: false }).nextCheck(0).mode, "full");
});

test("identical frames are skipped", () => {
  const s = make();
  s.recordSent(0, 100, false);
  assert.deepEqual(s.decide(5000, 0, "full"), { action: "skip-same" });
});

test("tiny changes are rate limited per mode", () => {
  const s = make();
  s.noteInput(0);
  s.recordSent(0, 100, false);
  assert.deepEqual(s.decide(400, 0.01, "full"), { action: "defer", delay: 600 });
  assert.deepEqual(s.decide(1000, 0.01, "full"), { action: "send", mode: "full" });
  assert.deepEqual(s.decide(400, 0.5, "full"), { action: "send", mode: "full" });
  const idle = make();
  idle.recordSent(0, 100, false);
  assert.deepEqual(idle.decide(3000, 0.01, "preview"), { action: "defer", delay: 2000 });
});

test("a full frame after a preview is sent even when unchanged", () => {
  const s = make();
  s.recordSent(0, 100, true);
  s.noteInput(100);
  assert.deepEqual(s.decide(200, 0, "full"), { action: "send", mode: "full" });
  assert.deepEqual(s.decide(200, 0, "preview"), { action: "skip-same" });
});
