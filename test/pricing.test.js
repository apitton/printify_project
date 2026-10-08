import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePrice } from '../shared/pricing.js';

test('multiplier rounds up to .99', () => {
  assert.equal(computePrice(1050, { mode: 'multiplier', value: 2, roundTo99: true }), 2199);
  assert.equal(computePrice(1000, { mode: 'multiplier', value: 2, roundTo99: true }), 2099);
  assert.equal(computePrice(1000, { mode: 'multiplier', value: 1.999, roundTo99: true }), 1999);
});

test('margin adds an amount in currency units', () => {
  assert.equal(computePrice(1234, { mode: 'margin', value: 10, roundTo99: false }), 2234);
});

test('fixed ignores cost', () => {
  assert.equal(computePrice(null, { mode: 'fixed', value: 24.99, roundTo99: false }), 2499);
});

test('shipping can be included in the cost basis', () => {
  assert.equal(computePrice(1000, { mode: 'margin', value: 5, includeShipping: true, roundTo99: false }, 475), 1975);
});
