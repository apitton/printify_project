// Production-cost sync. Costs come from temporary "probe" products (see providers/printify.js),
// which are tracked in `price_probes` so nothing is left behind in the shop.
import { query, withTransaction } from '../db/pool.js';
import { getProvider } from '../providers/index.js';
import { ensureBlueprintProviders, ensureBlueprints, ensureShipping, ensureVariants } from './catalog.js';

const DAY = 24 * 3600 * 1000;

/** Fetch and store costs for one blueprint/provider pair. */
export async function syncPairCosts(platform, shopId, blueprintId, printProviderId) {
  await ensureVariants(platform, blueprintId, printProviderId, { maxAgeDays: 1 });
  const { rows: variants } = await query(
    'SELECT id, placeholders FROM variants WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3 ORDER BY id',
    [platform, blueprintId, printProviderId],
  );
  if (!variants.length) return { variants: 0, costs: 0 };

  let costs, basis;
  try {
    ({ costs, basis } = await getProvider(platform).fetchVariantCosts({
      shopId, blueprintId, printProviderId, variants,
      onProbe: e => recordProbe(platform, shopId, blueprintId, printProviderId, e),
    }));
  } catch (err) {
    await query(
      'UPDATE blueprint_providers SET cost_error=$4 WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3',
      [platform, blueprintId, printProviderId, err.message.slice(0, 1000)],
    );
    throw err;
  }

  await withTransaction(async c => {
    for (const { variantId, costCents, currency } of costs) {
      const { rows: [prev] } = await c.query(
        'SELECT cost_cents FROM variant_costs WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3 AND variant_id=$4',
        [platform, blueprintId, printProviderId, variantId],
      );
      await c.query(
        `INSERT INTO variant_costs (platform, blueprint_id, print_provider_id, variant_id, cost_cents, currency, cost_basis, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (platform, blueprint_id, print_provider_id, variant_id)
         DO UPDATE SET cost_cents=EXCLUDED.cost_cents, currency=EXCLUDED.currency, cost_basis=EXCLUDED.cost_basis, fetched_at=now()`,
        [platform, blueprintId, printProviderId, variantId, costCents, currency, basis],
      );
      if (!prev || prev.cost_cents !== costCents) {
        await c.query(
          `INSERT INTO variant_cost_history (platform, blueprint_id, print_provider_id, variant_id, cost_cents, currency)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [platform, blueprintId, printProviderId, variantId, costCents, currency],
        );
      }
    }
    await c.query(
      `UPDATE blueprint_providers SET costs_synced_at=now(), cost_error=NULL
        WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3`,
      [platform, blueprintId, printProviderId],
    );
  });
  return { variants: variants.length, costs: costs.length };
}

async function recordProbe(platform, shopId, blueprintId, printProviderId, { event, productId, error }) {
  if (event === 'created' || event === 'failed') {
    await query(
      `INSERT INTO price_probes (platform, shop_id, blueprint_id, print_provider_id, external_product_id, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [platform, shopId, blueprintId, printProviderId, productId || null, event, error || null],
    );
  } else {
    await query(
      `UPDATE price_probes SET status=$3, error=$4, updated_at=now() WHERE platform=$1 AND external_product_id=$2`,
      [platform, productId, event, error || null],
    );
  }
}

/**
 * Job body: sync costs (and shipping) for the given blueprints, or all of them.
 * Pairs synced less than `maxAgeDays` ago are skipped, so an interrupted run can simply be restarted.
 */
export async function runPriceSync(ctx, { platform = 'printify', shopId, blueprintIds, pairs, all = false, maxAgeDays = 30 }) {
  if (!shopId) throw new Error('A shop is required: price probes are created in a shop and deleted right after');
  await ensureBlueprints(platform);

  // Optional restriction to specific blueprint/provider pairs.
  const onlyProviders = new Map();
  for (const p of pairs || []) {
    const bp = Number(p.blueprintId);
    if (!onlyProviders.has(bp)) onlyProviders.set(bp, new Set());
    onlyProviders.get(bp).add(Number(p.printProviderId));
  }

  let ids = [...new Set([...(blueprintIds || []).map(Number), ...onlyProviders.keys()])].filter(Boolean);
  if (all) {
    const { rows } = await query('SELECT id FROM blueprints WHERE platform=$1 ORDER BY id', [platform]);
    ids = rows.map(r => r.id);
  }
  if (!ids.length) throw new Error('No blueprints selected');

  const stats = { blueprints: ids.length, blueprintsDone: 0, pairsSynced: 0, pairsSkipped: 0, pairsFailed: 0, costs: 0 };
  await ctx.progress(stats);
  await ctx.log(`Syncing costs for ${ids.length} blueprint(s) using shop ${shopId}`);

  for (const blueprintId of ids) {
    if (ctx.cancelled()) { await ctx.log('Cancelled'); break; }
    let providerIds;
    try {
      providerIds = await ensureBlueprintProviders(platform, blueprintId);
    } catch (err) {
      await ctx.log(`Blueprint ${blueprintId}: cannot list providers (${err.message})`);
      stats.pairsFailed++;
      continue;
    }
    for (const ppId of providerIds) {
      if (ctx.cancelled()) break;
      if (onlyProviders.has(blueprintId) && !onlyProviders.get(blueprintId).has(ppId)) continue;
      const { rows: [pair] } = await query(
        'SELECT costs_synced_at FROM blueprint_providers WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3',
        [platform, blueprintId, ppId],
      );
      if (pair?.costs_synced_at && Date.now() - new Date(pair.costs_synced_at).getTime() < maxAgeDays * DAY) {
        stats.pairsSkipped++;
        continue;
      }
      try {
        const r = await syncPairCosts(platform, shopId, blueprintId, ppId);
        await ensureShipping(platform, blueprintId, ppId, { maxAgeDays: 1 }).catch(err =>
          ctx.log(`Blueprint ${blueprintId} / provider ${ppId}: shipping failed (${err.message})`));
        stats.pairsSynced++;
        stats.costs += r.costs;
        await ctx.log(`Blueprint ${blueprintId} / provider ${ppId}: ${r.costs}/${r.variants} variant costs`);
      } catch (err) {
        stats.pairsFailed++;
        await ctx.log(`Blueprint ${blueprintId} / provider ${ppId}: FAILED ${err.message}`);
      }
    }
    stats.blueprintsDone++;
    await ctx.progress(stats);
  }
  return stats;
}

/** Deletes any probe product that is still in the shop (failed deletes, crashes mid-run, ...). */
export async function runProbeCleanup(ctx, { platform = 'printify', shopId }) {
  const provider = getProvider(platform);
  let deleted = 0;

  const { rows } = await query(
    `SELECT id, shop_id, external_product_id FROM price_probes
      WHERE platform=$1 AND status IN ('created','delete_failed') AND external_product_id IS NOT NULL`,
    [platform],
  );
  for (const p of rows) {
    try {
      await provider.deleteProduct(p.shop_id, p.external_product_id);
    } catch (err) {
      if (err.status !== 404) { await ctx.log(`Probe ${p.external_product_id}: ${err.message}`); continue; }
    }
    await query(`UPDATE price_probes SET status='deleted', updated_at=now() WHERE id=$1`, [p.id]);
    deleted++;
  }

  // Also scan the shop itself, in case a probe was created but never recorded.
  // Collect first, delete after: deleting while paging would shift the pages.
  if (shopId && provider.listProducts) {
    const leftovers = [];
    for (let page = 1; ; page++) {
      const { items, lastPage } = await provider.listProducts(shopId, page);
      leftovers.push(...items.filter(i => i.title === provider.probeTitle));
      if (page >= lastPage || ctx.cancelled()) break;
    }
    for (const item of leftovers) {
      await provider.deleteProduct(shopId, item.id);
      deleted++;
    }
  }
  await ctx.log(`Deleted ${deleted} leftover probe product(s)`);
  return { deleted };
}
