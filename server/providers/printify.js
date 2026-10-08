// Printify adapter. Every platform adapter exposes the same normalised methods so the
// services (catalog sync, price sync, product creation) never deal with raw API shapes.
//
// Docs: https://developers.printify.com/
// Limits: 600 req/min global, catalog endpoints 100 req/min, publish 200 / 30 min.

import sharp from 'sharp';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/pool.js';
import { ProviderError, RateLimiter, requestJson } from './http.js';

const PLATFORM = 'printify';
export const PROBE_TITLE = '[pod-studio price probe] do not publish';
// Kept well under the documented limits to leave room for retries and the Printify UI.
const globalLimiter = new RateLimiter(500, 60_000);
const catalogLimiter = new RateLimiter(90, 60_000);
const publishLimiter = new RateLimiter(190, 30 * 60_000);
const MAX_VARIANTS_PER_PRODUCT = 100;

function api(path, { method = 'GET', body, catalog = false, publish = false } = {}) {
  if (!config.printify.token) {
    throw new ProviderError('PRINTIFY_TOKEN is not configured (.env)', { platform: PLATFORM, status: 401 });
  }
  const limiters = [globalLimiter];
  if (catalog) limiters.push(catalogLimiter);
  if (publish) limiters.push(publishLimiter);
  return requestJson({
    url: `${config.printify.baseUrl}${path}`,
    method,
    body,
    limiters,
    platform: PLATFORM,
    headers: {
      Authorization: `Bearer ${config.printify.token}`,
      'User-Agent': config.printify.userAgent,
    },
  });
}

// ------------------------------------------------------------------ catalog

export async function listShops() {
  const shops = await api('/v1/shops.json');
  return shops.map(s => ({ id: String(s.id), title: s.title, channel: s.sales_channel }));
}

export async function listBlueprints() {
  const data = await api('/v1/catalog/blueprints.json', { catalog: true });
  return data.map(b => ({
    id: b.id, title: b.title, description: b.description, brand: b.brand, model: b.model, images: b.images || [],
  }));
}

export async function listPrintProviders() {
  const data = await api('/v1/catalog/print_providers.json', { catalog: true });
  return data.map(p => ({ id: p.id, title: p.title, location: p.location || null }));
}

export async function listBlueprintProviders(blueprintId) {
  const data = await api(`/v1/catalog/blueprints/${blueprintId}/print_providers.json`, { catalog: true });
  return data.map(p => ({ id: p.id, title: p.title, location: p.location || null }));
}

export async function listVariants(blueprintId, printProviderId) {
  const base = `/v1/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`;
  // Default response = in-stock only; show-out-of-stock=1 = everything. Diff them to flag stock.
  const [inStock, all] = await Promise.all([
    api(base, { catalog: true }),
    api(`${base}?show-out-of-stock=1`, { catalog: true }),
  ]);
  const inStockIds = new Set((inStock.variants || []).map(v => v.id));
  return (all.variants || []).map(v => ({
    id: v.id,
    title: v.title,
    options: v.options || {},
    placeholders: (v.placeholders || []).map(p => ({ position: p.position, width: p.width, height: p.height })),
    decorationMethods: v.decoration_methods || [],
    inStock: inStockIds.has(v.id),
  }));
}

export async function listShippingProfiles(blueprintId, printProviderId) {
  const data = await api(`/v1/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/shipping.json`, { catalog: true });
  return (data.profiles || []).map(p => ({
    method: 'standard',
    variantIds: p.variant_ids || [],
    countries: p.countries || [],
    firstItemCents: p.first_item?.cost ?? 0,
    additionalItemCents: p.additional_items?.cost ?? 0,
    currency: p.first_item?.currency || 'USD',
    handlingTime: data.handling_time || null,
  }));
}

// ------------------------------------------------------------------ uploads & products

/** Upload by public URL (preferred for > 5MB) or by base64 contents. */
export async function uploadImage({ fileName, url, buffer }) {
  const body = url ? { file_name: fileName, url } : { file_name: fileName, contents: buffer.toString('base64') };
  const r = await api('/v1/uploads/images.json', { method: 'POST', body });
  return { id: r.id, width: r.width, height: r.height, previewUrl: r.preview_url };
}

/**
 * @param {string} shopId
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.description
 * @param {string[]} [p.tags]
 * @param {number} p.blueprintId
 * @param {number} p.printProviderId
 * @param {Array<{id:number, priceCents:number, enabled?:boolean}>} p.variants
 * @param {Array<{variantIds:number[], placeholders:Array<{position:string, imageId:string}>}>} p.printAreas
 */
export async function createProduct(shopId, p) {
  const body = {
    title: p.title,
    description: p.description || '',
    tags: p.tags || [],
    blueprint_id: p.blueprintId,
    print_provider_id: p.printProviderId,
    variants: p.variants.map(v => ({ id: v.id, price: v.priceCents, is_enabled: v.enabled !== false })),
    print_areas: p.printAreas.map(a => ({
      variant_ids: a.variantIds,
      placeholders: a.placeholders.map(ph => ({
        position: ph.position,
        // The uploaded image is rendered at the exact placeholder size, so it is centred at scale 1.
        images: [{ id: ph.imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
      })),
    })),
  };
  const r = await api(`/v1/shops/${shopId}/products.json`, { method: 'POST', body });
  return normalizeProduct(r);
}

export async function getProduct(shopId, productId) {
  return normalizeProduct(await api(`/v1/shops/${shopId}/products/${productId}.json`));
}

export async function listProducts(shopId, page = 1, limit = 50) {
  const r = await api(`/v1/shops/${shopId}/products.json?page=${page}&limit=${limit}`);
  return { items: (r.data || []).map(normalizeProduct), lastPage: r.last_page || 1 };
}

export async function deleteProduct(shopId, productId) {
  await api(`/v1/shops/${shopId}/products/${productId}.json`, { method: 'DELETE' });
}

export async function publishProduct(shopId, productId) {
  await api(`/v1/shops/${shopId}/products/${productId}/publish.json`, {
    method: 'POST',
    publish: true,
    body: { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true },
  });
}

function normalizeProduct(r) {
  return {
    id: String(r.id),
    title: r.title,
    visible: r.visible,
    blueprintId: r.blueprint_id,
    printProviderId: r.print_provider_id,
    variants: (r.variants || []).map(v => ({
      id: v.id, title: v.title, costCents: v.cost ?? null, priceCents: v.price ?? null, enabled: v.is_enabled,
    })),
    images: (r.images || []).map(i => ({ src: i.src, position: i.position, isDefault: i.is_default })),
    raw: r,
  };
}

// ------------------------------------------------------------------ costs

// A plain image uploaded once and reused for every price probe.
async function ensureProbeImageId() {
  const cached = await getSetting('printify.probeImageId');
  if (cached) return cached;
  const buffer = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#d0d0d0' } }).png().toBuffer();
  const img = await uploadImage({ fileName: 'pod-studio-price-probe.png', buffer });
  await setSetting('printify.probeImageId', img.id);
  return img.id;
}

/**
 * Printify's catalog does not expose production costs. They only appear on a product,
 * so we create a throw-away product, read each variant's `cost`, then delete it.
 * Only one print position is filled (front when available) so the cost is the base cost,
 * without surcharges for extra print areas.
 *
 * @param {object} p
 * @param {string} p.shopId
 * @param {number} p.blueprintId
 * @param {number} p.printProviderId
 * @param {Array<{id:number, placeholders:Array<{position:string}>}>} p.variants
 * @param {(e:{event:'created'|'deleted'|'delete_failed'|'failed', productId?:string, error?:string}) => Promise<void>} [p.onProbe]
 * @returns {Promise<{costs: Array<{variantId:number, costCents:number, currency:string}>, basis:string}>}
 */
export async function fetchVariantCosts({ shopId, blueprintId, printProviderId, variants, onProbe = async () => {} }) {
  const imageId = await ensureProbeImageId();
  const costs = [];
  const bases = new Set();

  for (let i = 0; i < variants.length; i += MAX_VARIANTS_PER_PRODUCT) {
    const chunk = variants.slice(i, i + MAX_VARIANTS_PER_PRODUCT);
    const groups = new Map();
    for (const v of chunk) {
      const positions = v.placeholders.map(ph => ph.position);
      if (!positions.length) continue;
      const position = positions.includes('front') ? 'front' : positions[0];
      if (!groups.has(position)) groups.set(position, []);
      groups.get(position).push(v.id);
      bases.add(position);
    }
    if (!groups.size) continue;

    let product;
    try {
      product = await createProduct(shopId, {
        title: PROBE_TITLE,
        description: 'Temporary product created to read production costs. Safe to delete.',
        blueprintId,
        printProviderId,
        variants: chunk.map(v => ({ id: v.id, priceCents: 100000, enabled: true })),
        printAreas: [...groups].map(([position, variantIds]) => ({ variantIds, placeholders: [{ position, imageId }] })),
      });
    } catch (err) {
      await onProbe({ event: 'failed', error: err.message });
      throw err;
    }
    await onProbe({ event: 'created', productId: product.id });

    const wanted = new Set(chunk.map(v => v.id));
    for (const v of product.variants) {
      if (wanted.has(v.id) && Number.isInteger(v.costCents)) {
        costs.push({ variantId: v.id, costCents: v.costCents, currency: 'USD' });
      }
    }

    try {
      await deleteProduct(shopId, product.id);
      await onProbe({ event: 'deleted', productId: product.id });
    } catch (err) {
      await onProbe({ event: 'delete_failed', productId: product.id, error: err.message });
    }
  }
  return { costs, basis: [...bases].sort().join('+') || 'none' };
}

export const printify = {
  platform: PLATFORM,
  label: 'Printify',
  probeTitle: PROBE_TITLE,
  listShops,
  listBlueprints,
  listPrintProviders,
  listBlueprintProviders,
  listVariants,
  listShippingProfiles,
  uploadImage,
  createProduct,
  getProduct,
  listProducts,
  deleteProduct,
  publishProduct,
  fetchVariantCosts,
};
