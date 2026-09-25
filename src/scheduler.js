"use strict";

const TITLE_BURST_MS = 1500;
const TINY_ACTIVE_GAP_MS = 1000;
const TINY_IDLE_GAP_MS = 5000;

class Scheduler {
  constructor(config) {
    this.activeFps = config.active_fps > 0 ? config.active_fps : 3;
    this.budgetBytesPerMs = config.active_budget_mb_per_s > 0 ? (config.active_budget_mb_per_s * 1e6) / 1000 : 0;
    this.heartbeatMs = Math.max(250, config.idle_heartbeat_s * 1000);
    this.idlePreview = config.idle_preview;
    this.tinyRows = config.tiny_change_rows;
    this.activeMs = config.active_ms;
    this.lastInputAt = -Infinity;
    this.burstUntil = -Infinity;
    this.lastSentAt = -Infinity;
    this.lastSentBytes = 0;
    this.lastWasPreview = false;
  }

  isActive(now) {
    return now - this.lastInputAt < this.activeMs || now < this.burstUntil;
  }

  noteInput(now) {
    const wasActive = this.isActive(now);
    this.lastInputAt = now;
    return !wasActive;
  }

  noteTitleChange(now) {
    this.burstUntil = now + TITLE_BURST_MS;
  }

  activeGapMs() {
    if (this.budgetBytesPerMs > 0) return this.lastSentBytes / this.budgetBytesPerMs;
    return 1000 / this.activeFps;
  }

  nextCheck(now) {
    if (this.isActive(now)) {
      return { delay: Math.max(0, this.lastSentAt + this.activeGapMs() - now), mode: "full" };
    }
    return { delay: Math.max(0, this.lastSentAt + this.heartbeatMs - now), mode: this.idlePreview ? "preview" : "full" };
  }

  decide(now, fraction, mode) {
    const upgrade = this.lastWasPreview && mode === "full";
    if (fraction === 0 && !upgrade) return { action: "skip-same" };
    if (!upgrade && fraction < this.tinyRows) {
      const gap = this.isActive(now) ? TINY_ACTIVE_GAP_MS : TINY_IDLE_GAP_MS;
      const since = now - this.lastSentAt;
      if (since < gap) return { action: "defer", delay: gap - since };
    }
    return { action: "send", mode };
  }

  recordSent(now, bytes, preview) {
    this.lastSentAt = now;
    this.lastSentBytes = bytes;
    this.lastWasPreview = preview;
  }
}

module.exports = { Scheduler, TITLE_BURST_MS, TINY_ACTIVE_GAP_MS, TINY_IDLE_GAP_MS };
