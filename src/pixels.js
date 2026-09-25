"use strict";

function halve(pixels, width, height) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  if (width < 2 || height < 2) return { pixels: Buffer.from(pixels.subarray(0, w * h * 4)), width: w, height: h };
  const out = Buffer.allocUnsafe(w * h * 4);
  const stride = width * 4;
  for (let y = 0; y < h; y++) {
    const top = 2 * y * stride;
    const bottom = top + stride;
    let o = y * w * 4;
    for (let x = 0; x < w; x++) {
      const a = top + 8 * x;
      const b = bottom + 8 * x;
      out[o] = (pixels[a] + pixels[a + 4] + pixels[b] + pixels[b + 4]) >> 2;
      out[o + 1] = (pixels[a + 1] + pixels[a + 5] + pixels[b + 1] + pixels[b + 5]) >> 2;
      out[o + 2] = (pixels[a + 2] + pixels[a + 6] + pixels[b + 2] + pixels[b + 6]) >> 2;
      out[o + 3] = 255;
      o += 4;
    }
  }
  return { pixels: out, width: w, height: h };
}

function changedRowFraction(previous, current) {
  if (!previous || previous.width !== current.width || previous.height !== current.height) return 1;
  if (previous.pixels.equals(current.pixels)) return 0;
  const stride = current.width * 4;
  let changed = 0;
  for (let row = 0; row < current.height; row++) {
    const at = row * stride;
    if (!previous.pixels.subarray(at, at + stride).equals(current.pixels.subarray(at, at + stride))) changed++;
  }
  return changed / current.height;
}

module.exports = { halve, changedRowFraction };
