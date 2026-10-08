// Retail price rules, shared by the UI (live preview) and the server (product creation).
// All amounts are integer cents.

export const PRICING_MODES = ['multiplier', 'margin', 'fixed'];

export const DEFAULT_PRICING = Object.freeze({
  mode: 'multiplier', // multiplier: cost x value | margin: cost + value | fixed: value
  value: 2,           // multiplier factor, or an amount in currency units for margin/fixed
  includeShipping: false, // add first-item shipping cost to the cost basis (for "free shipping" listings)
  roundTo99: true,    // round up to the next .99
});

/**
 * @param {number} costCents
 * @param {object} rule
 * @param {number} [shippingCents]
 * @returns {number} price in cents
 */
export function computePrice(costCents, rule = {}, shippingCents = 0) {
  const r = { ...DEFAULT_PRICING, ...rule };
  const value = Number(r.value) || 0;
  const basis = (Number(costCents) || 0) + (r.includeShipping ? Number(shippingCents) || 0 : 0);
  let price;
  if (r.mode === 'fixed') price = Math.round(value * 100);
  else if (r.mode === 'margin') price = basis + Math.round(value * 100);
  else price = Math.round(basis * value);
  if (r.roundTo99 && price > 0) price = Math.ceil((price + 1) / 100) * 100 - 1;
  return Math.max(price, 0);
}

export function formatCents(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}
