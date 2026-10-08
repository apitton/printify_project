# POD Studio

Compose a design from two layers, pick print-on-demand products, and create them on Printify
(other platforms later). The app renders the print files in the right size for every product.

## Setup

1. Node 20+ and PostgreSQL. Copy `.env.example` to `.env` and fill in `PRINTIFY_TOKEN` and `DATABASE_URL`.
2. Install and start the app:
   ```
   npm install
   npm start              # or: npm run dev (auto-restart)
   ```
   The server creates the database and applies migrations on startup (`npm run migrate` does it on its own).
3. Open http://localhost:3000.

## Workflow

1. **Design**: upload a back layer and a front layer.
   - The back layer fills the print area. *Auto* stretches it proportionally (with a slight crop). When the shapes are
     too different, it tiles instead, with mirrored repeats, e.g. a square pattern on a mug wrap. *Cover*, *tile* and
     *stretch* force one behaviour.
   - The front layer is centred and resized to fit. You can adjust its size and offset.
   - The preview uses the same layout code as the server renderer (`shared/layout.js`).
2. **Products**: search the catalog, then choose a print provider (with costs and US shipping), the variants
   (colours, sizes) and the print positions.
3. **Details & generate**: choose the shop, titles, description and tags, plus a pricing rule (cost ×, cost + margin
   or fixed, optional .99 rounding and shipping included). A per-variant table shows price and profit. *Create*
   starts a background job, which:
   - renders one print file per distinct placeholder size;
   - uploads each file;
   - creates the product, and publishes it if you asked;
   - records everything in the database.
4. **Catalog & prices**: sync the blueprint list, fetch production costs, and follow jobs.
5. **History**: every product created, with price, profit and status.

## Production costs

Printify's catalog API still does not return variant costs. They only appear on a product. To read them, the
app creates a temporary *price probe* product in your shop, with a single print position (front when there is
one, so the cost has no surcharge for extra print areas). It reads each variant's `cost` and deletes the probe
right away.

- Probes are recorded in `price_probes`. **Delete leftover price probes** removes any probe left behind, including
  untracked ones found by title.
- Costs are stored in `variant_costs`. `variant_cost_history` keeps a row each time a cost changes.
- A sync skips blueprint/provider pairs updated less than N days ago, so an interrupted full-catalog run can be
  restarted. A full run takes hours, because of the Printify rate limits (100 req/min on the catalog).
- Costs are also fetched automatically at product creation when they are unknown.

## Print file upload

Uploads are base64 by default. Printify recommends upload by URL above 5MB, so:

- if `PUBLIC_BASE_URL` is set (e.g. an ngrok tunnel to this server), files are uploaded by URL from
  `/files/renders/…`;
- otherwise, oversized opaque designs are sent as high-quality JPEG.

## Layout

```
server/
  index.js              Express app (API + static UI)
  config.js             env configuration
  db/                   pg pool, migration runner, SQL migrations
  providers/            one adapter per platform (printify.js) + registry; http.js = rate limits/retries
  services/             catalog sync, price sync, rendering, product creation, background jobs
  routes/               REST API
shared/                 code used by both browser and server (layout, pricing)
web/                    UI (plain ES modules, no build step)
test/                   node --test unit tests
samples/                sample layers
legacy/                 previous version of the project (reference only)
```

### Adding a platform

Create `server/providers/<name>.js` exposing the same methods as `printify.js`:

- catalog: `listBlueprints`, `listPrintProviders`, `listBlueprintProviders`, `listVariants`, `listShippingProfiles`;
- products: `uploadImage`, `createProduct`, `deleteProduct`, `publishProduct`, `listProducts`, `listShops`;
- costs: `fetchVariantCosts`.

Then register it in `server/providers/index.js`. Every table is keyed by `platform`.
