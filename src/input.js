"use strict";

const ESC = 0x1b;
const CTRL_Q = 0x11;
const PASTE_START = "\x1b[200~";
const PASTE_END = Buffer.from("\x1b[201~");
const EMPTY = Buffer.alloc(0);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

const CSI_LETTER_KEYS = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", P: "f1", Q: "f2", R: "f3", S: "f4" };
const CSI_TILDE_KEYS = {
  1: "home", 2: "insert", 3: "delete", 4: "end", 5: "pageup", 6: "pagedown", 7: "home", 8: "end",
  15: "f5", 17: "f6", 18: "f7", 19: "f8", 20: "f9", 21: "f10", 23: "f11", 24: "f12",
};

function mods(partial = {}) {
  return { shift: false, alt: false, ctrl: false, super: false, ...partial };
}

function modsFromParam(param) {
  const bits = Math.max(0, Number(param || 1) - 1);
  return mods({ shift: !!(bits & 1), alt: !!(bits & 2), ctrl: !!(bits & 4), super: !!(bits & 8) });
}

function keyEvent(key, text, modifiers) {
  const event = { type: "key", key, kind: "press", mods: mods(modifiers) };
  if (text !== undefined) event.text = text;
  return event;
}

// Length of the escape sequence at the start of `b`, 0 when it is still incomplete.
function sequenceLength(b) {
  if (b.length < 2) return 0;
  const kind = b[1];
  if (kind === 0x5b) {
    for (let i = 2; i < b.length; i++) {
      const c = b[i];
      if (c >= 0x40 && c <= 0x7e) return i + 1;
      if (c < 0x20 || c > 0x3f) return i;
    }
    return 0;
  }
  if (kind === 0x4f) return b.length >= 3 ? 3 : 0;
  if (kind === 0x5d || kind === 0x50 || kind === 0x5f || kind === 0x5e || kind === 0x58) {
    for (let i = 2; i < b.length; i++) {
      if (b[i] === 0x07) return i + 1;
      if (b[i] === ESC) return i + 1 < b.length ? i + 2 : 0;
    }
    return 0;
  }
  return 2;
}

function controlByte(ch) {
  if (ch === 0x0d || ch === 0x0a) return keyEvent("enter");
  if (ch === 0x7f || ch === 0x08) return keyEvent("backspace");
  if (ch === 0x09) return keyEvent("tab");
  if (ch === 0x00) return keyEvent(" ", undefined, { ctrl: true });
  if (ch >= 1 && ch <= 26) return keyEvent(String.fromCharCode(ch + 96), undefined, { ctrl: true });
  return null;
}

function textKeys(text, alt = false) {
  const events = [];
  for (const c of text) {
    const upper = c !== c.toLowerCase() && c === c.toUpperCase();
    events.push(keyEvent(c, alt ? undefined : c, { shift: upper, alt }));
  }
  return events;
}

function parseSequence(seq) {
  const s = seq.toString("latin1");
  if (s.startsWith("\x1b[<")) {
    const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(s);
    if (!m) return [];
    return [{ type: "mouse-report", code: Number(m[1]), x: Number(m[2]), y: Number(m[3]), release: m[4] === "m" }];
  }
  if (s === "\x1b[I" || s === "\x1b[O") return [{ type: "focus", focused: s === "\x1b[I" }];
  if (s === "\x1b[Z") return [keyEvent("tab", undefined, { shift: true })];
  if (s.length === 3 && s[1] === "O") {
    const key = CSI_LETTER_KEYS[s[2]];
    return key ? [keyEvent(key)] : [];
  }
  const csi = /^\x1b\[(\d*)(?:;(\d+))?([A-Za-z~])$/.exec(s);
  if (csi) {
    const [, num, modifier, final] = csi;
    if (final === "~") {
      const key = CSI_TILDE_KEYS[num];
      return key ? [keyEvent(key, undefined, modsFromParam(modifier))] : [];
    }
    const key = CSI_LETTER_KEYS[final];
    if (key && (num === "" || num === "1")) return [keyEvent(key, undefined, modsFromParam(modifier))];
    if (final === "t" || final === "y") return [{ type: "reply", text: s }];
    return [];
  }
  if (seq.length === 2) {
    const ch = seq[1];
    if (ch === ESC) return [keyEvent("escape", undefined, { alt: true })];
    const control = controlByte(ch);
    if (control) {
      control.mods.alt = true;
      return [control];
    }
    if (ch >= 0x20 && ch < 0x7f) return textKeys(String.fromCharCode(ch), true);
    return [];
  }
  return [{ type: "reply", text: s }];
}

class InputParser {
  constructor() {
    this.buf = EMPTY;
    this.paste = null;
  }

  get pending() {
    return this.buf.length > 0 && this.paste === null;
  }

  feed(data) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : Buffer.from(data);
    const events = [];
    while (this.buf.length) {
      if (this.paste !== null) {
        const end = this.buf.indexOf(PASTE_END);
        if (end === -1) {
          this.paste.push(this.buf);
          this.buf = EMPTY;
          break;
        }
        this.paste.push(this.buf.subarray(0, end));
        events.push({ type: "paste", text: Buffer.concat(this.paste).toString("utf8") });
        this.paste = null;
        this.buf = this.buf.subarray(end + PASTE_END.length);
        continue;
      }
      const b = this.buf;
      if (b[0] === ESC) {
        const len = sequenceLength(b);
        if (len === 0) break;
        const seq = b.subarray(0, len);
        this.buf = b.subarray(len);
        if (seq.toString("latin1") === PASTE_START) {
          this.paste = [];
          continue;
        }
        events.push(...parseSequence(seq));
        continue;
      }
      if (b[0] === CTRL_Q) {
        events.push({ type: "quit" });
        this.buf = b.subarray(1);
        continue;
      }
      const control = controlByte(b[0]);
      if (control) {
        events.push(control);
        this.buf = b.subarray(1);
        continue;
      }
      if (b[0] < 0x20) {
        this.buf = b.subarray(1);
        continue;
      }
      let stop = 0;
      while (stop < b.length && b[stop] >= 0x20 && b[stop] !== 0x7f) stop++;
      let text;
      let used = stop;
      for (; used > 0; used--) {
        try {
          text = UTF8.decode(b.subarray(0, used));
          break;
        } catch {}
      }
      if (used === 0) {
        if (stop < b.length || stop >= 4) this.buf = b.subarray(1);
        else break;
        continue;
      }
      events.push(...textKeys(text));
      this.buf = b.subarray(used);
    }
    return events;
  }

  // Called after a short quiet period: a lone ESC is the Escape key, anything else is dropped.
  flush() {
    if (!this.pending) return [];
    const lone = this.buf.length === 1 && this.buf[0] === ESC;
    this.buf = this.buf.subarray(1);
    const events = lone ? [keyEvent("escape")] : [];
    return events.concat(this.feed(EMPTY));
  }
}

function mouseToGuest(report, { pixelMouse, scale, size }) {
  let x;
  let y;
  if (pixelMouse) {
    x = Math.round((report.x - 1) * scale);
    y = Math.round((report.y - 1) * scale);
  } else {
    x = (report.x - 1) * size.cell[0] + Math.floor(size.cell[0] / 2);
    y = (report.y - 1) * size.cell[1] + Math.floor(size.cell[1] / 2);
  }
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
  const b = report.code;
  const modifiers = mods({ shift: !!(b & 4), alt: !!(b & 8), ctrl: !!(b & 16) });
  let kind;
  let button;
  if (b & 64) {
    kind = (b & 3) === 0 ? "scrollup" : "scrolldown";
    button = "none";
  } else if (b & 32) {
    kind = "move";
    button = "none";
  } else {
    kind = report.release ? "up" : "down";
    button = ["left", "middle", "right", "none"][b & 3];
  }
  return { type: "mouse", kind, button, mods: modifiers, x, y };
}

module.exports = { InputParser, mouseToGuest, sequenceLength };
