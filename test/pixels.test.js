"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { halve, changedRowFraction } = require("../src/pixels");

function image(width, height, fill) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(fill(i % width, Math.floor(i / width)), i * 4);
  return { pixels, width, height };
}

test("halve averages 2x2 blocks and forces opaque alpha", () => {
  const src = image(4, 2, (x) => (x % 2 === 0 ? [0, 100, 200, 0] : [100, 200, 0, 0]));
  const out = halve(src.pixels, src.width, src.height);
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
  assert.deepEqual([...out.pixels], [50, 150, 100, 255, 50, 150, 100, 255]);
});

test("halve drops an odd last row and column", () => {
  const src = image(5, 3, () => [10, 20, 30, 255]);
  const out = halve(src.pixels, 5, 3);
  assert.deepEqual([out.width, out.height, out.pixels.length], [2, 1, 8]);
  assert.deepEqual([...out.pixels.subarray(0, 4)], [10, 20, 30, 255]);
});

test("changedRowFraction", () => {
  const a = image(2, 4, () => [1, 1, 1, 1]);
  const b = image(2, 4, (x, y) => (y === 2 ? [9, 9, 9, 9] : [1, 1, 1, 1]));
  assert.equal(changedRowFraction(null, a), 1);
  assert.equal(changedRowFraction(a, image(2, 4, () => [1, 1, 1, 1])), 0);
  assert.equal(changedRowFraction(a, b), 0.25);
  assert.equal(changedRowFraction(a, image(4, 2, () => [1, 1, 1, 1])), 1);
});
