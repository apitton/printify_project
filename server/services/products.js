// Creates products from a design: renders one print file per distinct placeholder size,
// uploads it, then creates (and optionally publishes) the product on the platform.
import path from 'node:path';
import { query, withTransaction } from '../db/pool.js';
import { getProvider } from '../providers/index.js';
import { computePrice, DEFAULT_PRICING } from '../../shared/pricing.js';
import { ensureVariants } from './catalog.js';
import { syncPairCosts } from './prices.js';
import { prepareUpload, renderToFile } from './render.js';

/**
 * Job body.
 * @param {object} params
 * @param {string} [params.platform]
 * @param {number} params.designId
 * @param {string} params.shopId
 * @param {boolean} [params.publish]
 * @param {Array<{blueprintId:number, printProviderId:number, variantIds:number[], positions:string[],
 *   title:string, description?:string, tags?:string[], pricing?:object}>} params.items
 */
export async function runProductBatch(ctx, { platform = 'printify', designId, shopId, publish = false, items }) {
  if (!shopId) throw new Error('Select a shop first');
  if (!items?.length) throw new Error('No products selected');
  const { rows: [design] } = await query('SELECT * FROM designs WHERE id = $1', [designId]);
  if (!design) throw new Error(`Design ${designId} not found`);
  if (!design.bg_file && !design.fg_file) throw new Error('The design has no layers');

  const provider = getProvider(platform);
  const uploaded = new Map(); // render file -> image id, shared across the batch
  const results = [];
  const stats = { total: items.length, done: 0, failed: 0 };
  await ctx.progress(stats);

  for (const item of items) {
    if (ctx.cancelled()) { await ctx.log('Cancelled'); break; }
    const label = item.title || `blueprint ${item.blueprintId}`;
    let productId = null;
    try {
      productId = await createOne(ctx, { platform, provider, design, shopId, publish, item, uploaded });
      results.push({ productId, title: label, ok: true });
      stats.done++;
    } catch (err) {
      await ctx.log(`✗ ${label}: ${err.message}`);
      results.push({ productId, title: label, ok: false, error: err.message });
      stats.failed++;
    }
    await ctx.progress(stats);
  }
  return { ...stats, products: results };
}

async function createOne(ctx, { platform, provider, design, shopId, publish, item, uploaded }) {
  const blueprintId = Number(item.blueprintId);
  const printProviderId = Number(item.printProviderId);
  const pricing = { ...DEFAULT_PRICING, ...(item.pricing || {}) };
  const positions = new Set(item.positions?.length ? item.positions : ['front']);
  const tags = (item.tags || []).map(t => String(t).trim()).filter(Boolean);

  await ensureVariants(platform, blueprintId, printProviderId);
  let variants = await loadVariants(platform, blueprintId, printProviderId, item.variantIds);
  if (!variants.length) throw new Error('None of the selected variants exist anymore');

  // Costs are needed for pricing (except fixed prices): fetch them now if they were never synced.
  if (pricing.mode !== 'fixed' && variants.some(v => v.cost_cents === null)) {
    await ctx.log(`${item.title}: costs unknown, probing ${provider.label}…`);
    await syncPairCosts(platform, shopId, blueprintId, printProviderId);
    variants = await loadVariants(platform, blueprintId, printProviderId, item.variantIds);
  }

  const printable = variants.filter(v => v.placeholders.some(p => positions.has(p.position)));
  const skipped = variants.length - printable.length;
  if (skipped) await ctx.log(`${item.title}: ${skipped} variant(s) skipped (no ${[...positions].join('/')} print area)`);
  if (!printable.length) throw new Error(`No selected variant has a ${[...positions].join('/')} print area`);

  const priced = printable.map(v => {
    if (pricing.mode !== 'fixed' && v.cost_cents === null) throw new Error(`No cost known for variant ${v.id} (${v.title})`);
    return { ...v, price_cents: computePrice(v.cost_cents, pricing, v.shipping_cents) };
  });

  const { rows: [row] } = await query(
    `INSERT INTO products (design_id, platform, shop_id, blueprint_id, print_provider_id, title, description, tags, positions, pricing, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'rendering') RETURNING id`,
    [design.id, platform, shopId, blueprintId, printProviderId, item.title, item.description || '', tags, [...positions], pricing],
  );
  const productId = row.id;
  const setStatus = (status, extra = {}) => query(
    `UPDATE products SET status=$2, error=$3, external_id=COALESCE($4, external_id), external_data=COALESCE($5, external_data), updated_at=now() WHERE id=$1`,
    [productId, status, extra.error || null, extra.externalId || null, extra.externalData ? JSON.stringify(extra.externalData) : null],
  );

  try {
    // Group variants sharing identical print areas (same positions and sizes) into one print area.
    const areas = new Map();
    for (const v of priced) {
      const phs = v.placeholders.filter(p => positions.has(p.position)).sort((a, b) => a.position.localeCompare(b.position));
      const key = JSON.stringify(phs);
      if (!areas.has(key)) areas.set(key, { variantIds: [], placeholders: phs });
      areas.get(key).variantIds.push(v.id);
    }

    const images = [];
    const printAreas = [];
    for (const area of areas.values()) {
      const placeholders = [];
      for (const ph of area.placeholders) {
        const file = await renderToFile(design, { width: ph.width, height: ph.height });
        if (!uploaded.has(file)) {
          await setStatus('uploading');
          await ctx.log(`${item.title}: uploading ${ph.width}×${ph.height} print file`);
          const img = await provider.uploadImage(await prepareUpload(design, file));
          uploaded.set(file, img.id);
        }
        const imageId = uploaded.get(file);
        placeholders.push({ position: ph.position, imageId });
        images.push({ position: ph.position, width: ph.width, height: ph.height, variantIds: area.variantIds, file: path.basename(file), imageId });
      }
      printAreas.push({ variantIds: area.variantIds, placeholders });
    }

    const created = await provider.createProduct(shopId, {
      title: item.title,
      description: item.description || '',
      tags,
      blueprintId,
      printProviderId,
      variants: priced.map(v => ({ id: v.id, priceCents: v.price_cents, enabled: true })),
      printAreas,
    });
    const actualCost = new Map(created.variants.map(v => [v.id, v.costCents]));

    await withTransaction(async c => {
      for (const v of priced) {
        await c.query(
          `INSERT INTO product_variants (product_id, variant_id, title, price_cents, cost_cents) VALUES ($1,$2,$3,$4,$5)`,
          [productId, v.id, v.title, v.price_cents, actualCost.get(v.id) ?? v.cost_cents],
        );
      }
      for (const img of images) {
        await c.query(
          `INSERT INTO product_images (product_id, position, width, height, variant_ids, file, external_image_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [productId, img.position, img.width, img.height, img.variantIds, img.file, img.imageId],
        );
      }
    });
    await setStatus('created', { externalId: created.id, externalData: { images: created.images } });
    await ctx.log(`✓ ${item.title}: created ${provider.label} product ${created.id} (${priced.length} variants)`);

    if (publish) {
      await provider.publishProduct(shopId, created.id);
      await setStatus('published');
      await ctx.log(`✓ ${item.title}: publish requested`);
    }
    return productId;
  } catch (err) {
    await setStatus('failed', { error: err.message });
    err.productId = productId;
    throw err;
  }
}

async function loadVariants(platform, blueprintId, printProviderId, variantIds) {
  const { rows } = await query(
    `SELECT v.id, v.title, v.placeholders, vc.cost_cents,
            (SELECT first_item_cents FROM shipping_profiles sp WHERE sp.platform=v.platform AND sp.blueprint_id=v.blueprint_id
               AND sp.print_provider_id=v.print_provider_id AND v.id = ANY(sp.variant_ids) AND 'US' = ANY(sp.countries) LIMIT 1) AS shipping_cents
       FROM variants v
       LEFT JOIN variant_costs vc ON vc.platform=v.platform AND vc.blueprint_id=v.blueprint_id
            AND vc.print_provider_id=v.print_provider_id AND vc.variant_id=v.id
      WHERE v.platform=$1 AND v.blueprint_id=$2 AND v.print_provider_id=$3 AND v.id = ANY($4::bigint[])
      ORDER BY v.id`,
    [platform, blueprintId, printProviderId, (variantIds || []).map(Number)],
  );
  return rows;
}

export async function listProducts({ limit = 100, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT p.*, d.name AS design_name, b.title AS blueprint_title, pp.title AS print_provider_title,
            (SELECT count(*) FROM product_variants pv WHERE pv.product_id = p.id)::int AS variant_count,
            (SELECT min(price_cents) FROM product_variants pv WHERE pv.product_id = p.id) AS min_price_cents,
            (SELECT min(price_cents - cost_cents) FROM product_variants pv WHERE pv.product_id = p.id) AS min_profit_cents
       FROM products p
       LEFT JOIN designs d ON d.id = p.design_id
       LEFT JOIN blueprints b ON b.platform = p.platform AND b.id = p.blueprint_id
       LEFT JOIN print_providers pp ON pp.platform = p.platform AND pp.id = p.print_provider_id
      ORDER BY p.id DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function getProductDetail(id) {
  const { rows: [product] } = await query('SELECT * FROM products WHERE id=$1', [id]);
  if (!product) return null;
  const { rows: variants } = await query('SELECT * FROM product_variants WHERE product_id=$1 ORDER BY variant_id', [id]);
  const { rows: images } = await query('SELECT * FROM product_images WHERE product_id=$1 ORDER BY id', [id]);
  return { ...product, variants, images };
}

export async function publishExisting(id) {
  const { rows: [p] } = await query('SELECT * FROM products WHERE id=$1', [id]);
  if (!p?.external_id) throw Object.assign(new Error('Product was not created on the platform'), { status: 400 });
  await getProvider(p.platform).publishProduct(p.shop_id, p.external_id);
  await query(`UPDATE products SET status='published', updated_at=now() WHERE id=$1`, [id]);
}
