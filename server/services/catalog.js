// Mirrors the provider catalog into Postgres. The blueprint list is synced explicitly;
// providers / variants / shipping per blueprint are fetched lazily and cached
// (fetching everything would take ~1h with Printify's 100 req/min catalog limit).
import { query, withTransaction } from '../db/pool.js';
import { getProvider } from '../providers/index.js';

const DAY = 24 * 3600 * 1000;
const isFresh = (ts, maxAgeDays) => ts && Date.now() - new Date(ts).getTime() < maxAgeDays * DAY;

export async function syncBlueprints(platform = 'printify') {
  const provider = getProvider(platform);
  const [blueprints, printProviders] = await Promise.all([provider.listBlueprints(), provider.listPrintProviders()]);
  await withTransaction(async c => {
    for (const b of blueprints) {
      await c.query(
        `INSERT INTO blueprints (platform, id, title, description, brand, model, images, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (platform, id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
           brand=EXCLUDED.brand, model=EXCLUDED.model, images=EXCLUDED.images, synced_at=now()`,
        [platform, b.id, b.title, b.description, b.brand, b.model, JSON.stringify(b.images)],
      );
    }
    for (const p of printProviders) await upsertPrintProvider(c, platform, p);
  });
  return { blueprints: blueprints.length, printProviders: printProviders.length };
}

async function upsertPrintProvider(c, platform, p) {
  await c.query(
    `INSERT INTO print_providers (platform, id, title, location, synced_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (platform, id) DO UPDATE SET title=EXCLUDED.title,
       location=COALESCE(EXCLUDED.location, print_providers.location), synced_at=now()`,
    [platform, p.id, p.title, p.location ? JSON.stringify(p.location) : null],
  );
}

export async function ensureBlueprints(platform = 'printify') {
  const { rows } = await query('SELECT count(*)::int AS n FROM blueprints WHERE platform = $1', [platform]);
  if (!rows[0].n) await syncBlueprints(platform);
}

/** Providers offering a blueprint, fetched from the API unless already cached. */
export async function ensureBlueprintProviders(platform, blueprintId, { force = false } = {}) {
  const { rows } = await query(
    'SELECT print_provider_id FROM blueprint_providers WHERE platform = $1 AND blueprint_id = $2',
    [platform, blueprintId],
  );
  if (rows.length && !force) return rows.map(r => r.print_provider_id);

  const list = await getProvider(platform).listBlueprintProviders(blueprintId);
  await withTransaction(async c => {
    for (const p of list) {
      await upsertPrintProvider(c, platform, p);
      await c.query(
        `INSERT INTO blueprint_providers (platform, blueprint_id, print_provider_id) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [platform, blueprintId, p.id],
      );
    }
  });
  return list.map(p => p.id);
}

export async function ensureVariants(platform, blueprintId, printProviderId, { maxAgeDays = 7, force = false } = {}) {
  const pair = await getPair(platform, blueprintId, printProviderId);
  if (!force && isFresh(pair?.variants_synced_at, maxAgeDays)) return;

  const variants = await getProvider(platform).listVariants(blueprintId, printProviderId);
  await withTransaction(async c => {
    await c.query(
      `INSERT INTO blueprint_providers (platform, blueprint_id, print_provider_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [platform, blueprintId, printProviderId],
    );
    const ids = variants.map(v => v.id);
    // Variants removed by the provider disappear (with their costs, via cascade).
    await c.query(
      `DELETE FROM variants WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3 AND NOT (id = ANY($4::bigint[]))`,
      [platform, blueprintId, printProviderId, ids],
    );
    for (const v of variants) {
      await c.query(
        `INSERT INTO variants (platform, blueprint_id, print_provider_id, id, title, options, placeholders, decoration_methods, in_stock, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT (platform, blueprint_id, print_provider_id, id) DO UPDATE SET title=EXCLUDED.title, options=EXCLUDED.options,
           placeholders=EXCLUDED.placeholders, decoration_methods=EXCLUDED.decoration_methods, in_stock=EXCLUDED.in_stock, synced_at=now()`,
        [platform, blueprintId, printProviderId, v.id, v.title, JSON.stringify(v.options),
          JSON.stringify(v.placeholders), JSON.stringify(v.decorationMethods), v.inStock],
      );
    }
    await c.query(
      `UPDATE blueprint_providers SET variants_synced_at = now() WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3`,
      [platform, blueprintId, printProviderId],
    );
  });
}

export async function ensureShipping(platform, blueprintId, printProviderId, { maxAgeDays = 7, force = false } = {}) {
  const pair = await getPair(platform, blueprintId, printProviderId);
  if (!force && isFresh(pair?.shipping_synced_at, maxAgeDays)) return;

  const profiles = await getProvider(platform).listShippingProfiles(blueprintId, printProviderId);
  await withTransaction(async c => {
    await c.query(
      `DELETE FROM shipping_profiles WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3`,
      [platform, blueprintId, printProviderId],
    );
    for (const p of profiles) {
      await c.query(
        `INSERT INTO shipping_profiles (platform, blueprint_id, print_provider_id, method, variant_ids, countries,
           first_item_cents, additional_item_cents, currency, handling_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [platform, blueprintId, printProviderId, p.method, p.variantIds, p.countries,
          p.firstItemCents, p.additionalItemCents, p.currency, p.handlingTime ? JSON.stringify(p.handlingTime) : null],
      );
    }
    await c.query(
      `UPDATE blueprint_providers SET shipping_synced_at = now() WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3`,
      [platform, blueprintId, printProviderId],
    );
  });
}

async function getPair(platform, blueprintId, printProviderId) {
  const { rows } = await query(
    'SELECT * FROM blueprint_providers WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3',
    [platform, blueprintId, printProviderId],
  );
  return rows[0] || null;
}

// ------------------------------------------------------------------ read models for the UI

export async function searchBlueprints(platform, { q = '', limit = 50, offset = 0, onlyPriced = false }) {
  const { rows } = await query(
    `SELECT b.id, b.title, b.brand, b.model, b.images->>0 AS image,
            count(DISTINCT bp.print_provider_id)::int AS provider_count,
            min(vc.cost_cents) AS min_cost_cents,
            max(vc.fetched_at) AS costs_fetched_at,
            count(*) OVER ()::int AS total
       FROM blueprints b
       LEFT JOIN blueprint_providers bp ON bp.platform = b.platform AND bp.blueprint_id = b.id
       LEFT JOIN variant_costs vc ON vc.platform = b.platform AND vc.blueprint_id = b.id
      WHERE b.platform = $1
        AND ($2 = '' OR b.title ILIKE '%' || $2 || '%' OR b.brand ILIKE '%' || $2 || '%' OR b.model ILIKE '%' || $2 || '%')
      GROUP BY b.platform, b.id
     HAVING NOT $5 OR min(vc.cost_cents) IS NOT NULL
      ORDER BY b.title
      LIMIT $3 OFFSET $4`,
    [platform, q.trim(), limit, offset, onlyPriced],
  );
  return { total: rows[0]?.total ?? 0, items: rows.map(({ total, ...r }) => r) };
}

export async function getBlueprintWithProviders(platform, blueprintId) {
  await ensureBlueprints(platform);
  const { rows: [blueprint] } = await query('SELECT * FROM blueprints WHERE platform=$1 AND id=$2', [platform, blueprintId]);
  if (!blueprint) return null;
  await ensureBlueprintProviders(platform, blueprintId);
  const { rows: providers } = await query(
    `SELECT pp.id, pp.title, pp.location, bp.variants_synced_at, bp.costs_synced_at, bp.cost_error,
            (SELECT count(*) FROM variants v WHERE v.platform=bp.platform AND v.blueprint_id=bp.blueprint_id AND v.print_provider_id=bp.print_provider_id)::int AS variant_count,
            (SELECT min(cost_cents) FROM variant_costs vc WHERE vc.platform=bp.platform AND vc.blueprint_id=bp.blueprint_id AND vc.print_provider_id=bp.print_provider_id) AS min_cost_cents,
            (SELECT max(cost_cents) FROM variant_costs vc WHERE vc.platform=bp.platform AND vc.blueprint_id=bp.blueprint_id AND vc.print_provider_id=bp.print_provider_id) AS max_cost_cents,
            (SELECT min(first_item_cents) FROM shipping_profiles sp WHERE sp.platform=bp.platform AND sp.blueprint_id=bp.blueprint_id AND sp.print_provider_id=bp.print_provider_id AND 'US' = ANY(sp.countries)) AS us_shipping_cents
       FROM blueprint_providers bp
       JOIN print_providers pp ON pp.platform = bp.platform AND pp.id = bp.print_provider_id
      WHERE bp.platform = $1 AND bp.blueprint_id = $2
      ORDER BY min_cost_cents NULLS LAST, pp.title`,
    [platform, blueprintId],
  );
  return { ...blueprint, providers };
}

export async function getProviderVariants(platform, blueprintId, printProviderId) {
  await ensureVariants(platform, blueprintId, printProviderId);
  await ensureShipping(platform, blueprintId, printProviderId).catch(err => console.warn('shipping sync failed', err.message));
  const { rows: variants } = await query(
    `SELECT v.id, v.title, v.options, v.placeholders, v.in_stock, vc.cost_cents, vc.currency, vc.fetched_at AS cost_fetched_at,
            (SELECT first_item_cents FROM shipping_profiles sp WHERE sp.platform=v.platform AND sp.blueprint_id=v.blueprint_id
               AND sp.print_provider_id=v.print_provider_id AND v.id = ANY(sp.variant_ids) AND 'US' = ANY(sp.countries) LIMIT 1) AS us_shipping_cents
       FROM variants v
       LEFT JOIN variant_costs vc ON vc.platform=v.platform AND vc.blueprint_id=v.blueprint_id
            AND vc.print_provider_id=v.print_provider_id AND vc.variant_id=v.id
      WHERE v.platform=$1 AND v.blueprint_id=$2 AND v.print_provider_id=$3
      ORDER BY v.id`,
    [platform, blueprintId, printProviderId],
  );
  const { rows: shipping } = await query(
    `SELECT method, variant_ids, countries, first_item_cents, additional_item_cents, currency, handling_time
       FROM shipping_profiles WHERE platform=$1 AND blueprint_id=$2 AND print_provider_id=$3`,
    [platform, blueprintId, printProviderId],
  );
  const pair = await getPair(platform, blueprintId, printProviderId);
  return { variants, shipping, costsSyncedAt: pair?.costs_synced_at, costError: pair?.cost_error };
}
