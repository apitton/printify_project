import { Router } from 'express';
import { config } from '../config.js';
import { getSetting, query, setSetting } from '../db/pool.js';
import { getProvider, listPlatforms } from '../providers/index.js';
import { getBlueprintWithProviders, getProviderVariants, searchBlueprints, syncBlueprints } from '../services/catalog.js';
import { cancelJob, getJob, listJobs, startJob } from '../services/jobs.js';
import { runPriceSync, runProbeCleanup } from '../services/prices.js';
import { getProductDetail, listProducts, publishExisting, runProductBatch } from '../services/products.js';
import { router as designs } from './designs.js';

export const router = Router();
router.use('/designs', designs);

const platformOf = req => req.query.platform || req.body?.platform || 'printify';

async function resolveShopId(req, platform) {
  return String(req.body?.shopId || (await getSetting(`${platform}.shopId`)) || (platform === 'printify' ? config.printify.defaultShopId : '') || '');
}

// ------------------------------------------------------------------ status & settings

router.get('/status', async (_req, res) => {
  const { rows: [counts] } = await query(`SELECT
      (SELECT count(*) FROM blueprints)::int AS blueprints,
      (SELECT count(*) FROM blueprint_providers WHERE costs_synced_at IS NOT NULL)::int AS priced_pairs,
      (SELECT count(*) FROM blueprint_providers)::int AS known_pairs,
      (SELECT count(*) FROM variant_costs)::int AS variant_costs,
      (SELECT max(fetched_at) FROM variant_costs) AS last_cost_sync,
      (SELECT count(*) FROM designs)::int AS designs,
      (SELECT count(*) FROM products)::int AS products,
      (SELECT count(*) FROM price_probes WHERE status IN ('created','delete_failed'))::int AS leftover_probes`);
  res.json({
    platforms: listPlatforms(),
    printifyTokenConfigured: Boolean(config.printify.token),
    publicBaseUrl: config.publicBaseUrl || null,
    shopId: await resolveShopId({ body: {} }, 'printify'),
    counts,
  });
});

router.get('/shops', async (req, res) => {
  res.json(await getProvider(platformOf(req)).listShops());
});

router.put('/settings/shop', async (req, res) => {
  await setSetting(`${platformOf(req)}.shopId`, String(req.body.shopId || ''));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ catalog

router.post('/catalog/sync', async (req, res) => {
  const platform = platformOf(req);
  const jobId = await startJob('catalog-sync', { platform }, async ctx => {
    const r = await syncBlueprints(platform);
    await ctx.log(`Synced ${r.blueprints} blueprints and ${r.printProviders} print providers`);
    return r;
  });
  res.status(202).json({ jobId });
});

router.get('/catalog/blueprints', async (req, res) => {
  res.json(await searchBlueprints(platformOf(req), {
    q: String(req.query.q || ''),
    limit: Math.min(Number(req.query.limit) || 50, 200),
    offset: Number(req.query.offset) || 0,
    onlyPriced: req.query.onlyPriced === '1',
  }));
});

router.get('/catalog/blueprints/:id', async (req, res) => {
  const bp = await getBlueprintWithProviders(platformOf(req), Number(req.params.id));
  if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
  res.json(bp);
});

router.get('/catalog/blueprints/:id/providers/:ppId', async (req, res) => {
  res.json(await getProviderVariants(platformOf(req), Number(req.params.id), Number(req.params.ppId)));
});

// ------------------------------------------------------------------ prices

router.post('/prices/sync', async (req, res) => {
  const platform = platformOf(req);
  const params = {
    platform,
    shopId: await resolveShopId(req, platform),
    blueprintIds: req.body.blueprintIds || [],
    pairs: req.body.pairs || [],
    all: Boolean(req.body.all),
    maxAgeDays: req.body.force ? 0 : Number(req.body.maxAgeDays ?? 30),
  };
  if (!params.shopId) return res.status(400).json({ error: 'Select a shop first' });
  const jobId = await startJob('price-sync', params, ctx => runPriceSync(ctx, params));
  res.status(202).json({ jobId });
});

router.post('/prices/cleanup', async (req, res) => {
  const platform = platformOf(req);
  const params = { platform, shopId: await resolveShopId(req, platform) };
  const jobId = await startJob('probe-cleanup', params, ctx => runProbeCleanup(ctx, params));
  res.status(202).json({ jobId });
});

router.get('/prices/history/:blueprintId/:ppId/:variantId', async (req, res) => {
  const { rows } = await query(
    `SELECT cost_cents, currency, fetched_at FROM variant_cost_history
      WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3 AND variant_id=$4 ORDER BY fetched_at`,
    [platformOf(req), req.params.blueprintId, req.params.ppId, req.params.variantId],
  );
  res.json(rows);
});

// ------------------------------------------------------------------ products

router.post('/products/batch', async (req, res) => {
  const platform = platformOf(req);
  const params = {
    platform,
    designId: Number(req.body.designId),
    shopId: await resolveShopId(req, platform),
    publish: Boolean(req.body.publish),
    items: req.body.items || [],
  };
  if (!params.shopId) return res.status(400).json({ error: 'Select a shop first' });
  if (!params.items.length) return res.status(400).json({ error: 'No products selected' });
  const jobId = await startJob('product-batch', { ...params, items: params.items.length }, ctx => runProductBatch(ctx, params));
  res.status(202).json({ jobId });
});

router.get('/products', async (req, res) => {
  res.json(await listProducts({ limit: Math.min(Number(req.query.limit) || 100, 500), offset: Number(req.query.offset) || 0 }));
});

router.get('/products/:id', async (req, res) => {
  const p = await getProductDetail(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

router.post('/products/:id/publish', async (req, res) => {
  await publishExisting(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ jobs

router.get('/jobs', async (_req, res) => res.json(await listJobs()));

router.get('/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/jobs/:id/cancel', (req, res) => res.json({ cancelled: cancelJob(req.params.id) }));
