import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../shared/layout.js';

const covers = (tiles, W, H) => {
  const minX = Math.min(...tiles.map(t => t.x)), minY = Math.min(...tiles.map(t => t.y));
  const maxX = Math.max(...tiles.map(t => t.x + t.w)), maxY = Math.max(...tiles.map(t => t.y + t.h));
  return minX <= 0 && minY <= 0 && maxX >= W && maxY >= H;
};

test('cover mode fills the target with a single centred tile', () => {
  const l = computeLayout({ width: 1000, height: 1200 }, { width: 900, height: 1000 }, null, { bgMode: 'cover' });
  assert.equal(l.bgTiles.length, 1);
  assert.ok(covers(l.bgTiles, 1000, 1200));
});

test('auto mode tiles when aspect ratios differ a lot (square pattern on a mug wrap)', () => {
  const l = computeLayout({ width: 2700, height: 1100 }, { width: 1000, height: 1000 }, null, { bgMode: 'auto' });
  assert.equal(l.bgMode, 'tile');
  assert.ok(l.bgTiles.length >= 3);
  assert.ok(l.bgTiles.every(t => t.h === 1100));
  assert.ok(covers(l.bgTiles, 2700, 1100));
  // centre tile is not mirrored, neighbours are
  const centre = l.bgTiles.find(t => t.x === Math.round((2700 - 1100) / 2));
  assert.equal(centre.flipX, false);
});

test('auto mode covers when aspect ratios are close', () => {
  const l = computeLayout({ width: 4500, height: 5100 }, { width: 4000, height: 4800 }, null);
  assert.equal(l.bgMode, 'cover');
});

test('front layer is centred and fits inside the target', () => {
  const l = computeLayout({ width: 2000, height: 1000 }, null, { width: 500, height: 500 }, { fgScale: 0.8 });
  assert.deepEqual(l.fg, { x: 600, y: 100, w: 800, h: 800 });
});

test('front layer offset moves it relative to target size', () => {
  const l = computeLayout({ width: 1000, height: 1000 }, null, { width: 100, height: 100 }, { fgScale: 0.5, fgOffsetY: -0.1 });
  assert.equal(l.fg.y, 150);
});
