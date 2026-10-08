-- Every catalog / product table carries a `platform` column so other providers
-- (Printful, Gelato, ...) can share the same schema later.

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- catalog

CREATE TABLE blueprints (
  platform    TEXT   NOT NULL,
  id          BIGINT NOT NULL,
  title       TEXT   NOT NULL,
  description TEXT,
  brand       TEXT,
  model       TEXT,
  images      JSONB  NOT NULL DEFAULT '[]',
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, id)
);
CREATE INDEX blueprints_title_idx ON blueprints (platform, lower(title));

CREATE TABLE print_providers (
  platform  TEXT   NOT NULL,
  id        BIGINT NOT NULL,
  title     TEXT   NOT NULL,
  location  JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, id)
);

-- Which provider offers which blueprint, plus sync bookkeeping for that pair.
CREATE TABLE blueprint_providers (
  platform           TEXT   NOT NULL,
  blueprint_id       BIGINT NOT NULL,
  print_provider_id  BIGINT NOT NULL,
  variants_synced_at TIMESTAMPTZ,
  costs_synced_at    TIMESTAMPTZ,
  shipping_synced_at TIMESTAMPTZ,
  cost_error         TEXT,
  PRIMARY KEY (platform, blueprint_id, print_provider_id),
  FOREIGN KEY (platform, blueprint_id) REFERENCES blueprints (platform, id) ON DELETE CASCADE,
  FOREIGN KEY (platform, print_provider_id) REFERENCES print_providers (platform, id) ON DELETE CASCADE
);

-- Variant ids are shared between providers of the same blueprint, so the provider is part of the key.
CREATE TABLE variants (
  platform           TEXT   NOT NULL,
  blueprint_id       BIGINT NOT NULL,
  print_provider_id  BIGINT NOT NULL,
  id                 BIGINT NOT NULL,
  title              TEXT   NOT NULL,
  options            JSONB  NOT NULL DEFAULT '{}',
  placeholders       JSONB  NOT NULL DEFAULT '[]',  -- [{position, width, height}]
  decoration_methods JSONB  NOT NULL DEFAULT '[]',
  in_stock           BOOLEAN NOT NULL DEFAULT true,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, blueprint_id, print_provider_id, id),
  FOREIGN KEY (platform, blueprint_id, print_provider_id)
    REFERENCES blueprint_providers (platform, blueprint_id, print_provider_id) ON DELETE CASCADE
);

-- Production cost per variant. Printify does not expose it in the catalog, so it is
-- captured from a temporary "price probe" product (see services/priceSync.js).
CREATE TABLE variant_costs (
  platform          TEXT    NOT NULL,
  blueprint_id      BIGINT  NOT NULL,
  print_provider_id BIGINT  NOT NULL,
  variant_id        BIGINT  NOT NULL,
  cost_cents        INTEGER NOT NULL,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  cost_basis        TEXT    NOT NULL,             -- print position(s) used when probing, e.g. 'front'
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, blueprint_id, print_provider_id, variant_id),
  FOREIGN KEY (platform, blueprint_id, print_provider_id, variant_id)
    REFERENCES variants (platform, blueprint_id, print_provider_id, id) ON DELETE CASCADE
);

-- One row each time a cost is first seen or changes.
CREATE TABLE variant_cost_history (
  id                BIGSERIAL PRIMARY KEY,
  platform          TEXT    NOT NULL,
  blueprint_id      BIGINT  NOT NULL,
  print_provider_id BIGINT  NOT NULL,
  variant_id        BIGINT  NOT NULL,
  cost_cents        INTEGER NOT NULL,
  currency          TEXT    NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX variant_cost_history_variant_idx
  ON variant_cost_history (platform, blueprint_id, print_provider_id, variant_id, fetched_at DESC);

-- Shipping profiles as returned by the provider (one row per profile, not per country x variant).
CREATE TABLE shipping_profiles (
  id                    BIGSERIAL PRIMARY KEY,
  platform              TEXT     NOT NULL,
  blueprint_id          BIGINT   NOT NULL,
  print_provider_id     BIGINT   NOT NULL,
  method                TEXT     NOT NULL DEFAULT 'standard',
  variant_ids           BIGINT[] NOT NULL,
  countries             TEXT[]   NOT NULL,
  first_item_cents      INTEGER  NOT NULL,
  additional_item_cents INTEGER  NOT NULL,
  currency              TEXT     NOT NULL DEFAULT 'USD',
  handling_time         JSONB,
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (platform, blueprint_id, print_provider_id)
    REFERENCES blueprint_providers (platform, blueprint_id, print_provider_id) ON DELETE CASCADE
);
CREATE INDEX shipping_profiles_pair_idx ON shipping_profiles (platform, blueprint_id, print_provider_id);

-- Temporary products created only to read costs; kept so leftovers can always be cleaned up.
CREATE TABLE price_probes (
  id                  BIGSERIAL PRIMARY KEY,
  platform            TEXT   NOT NULL,
  shop_id             TEXT   NOT NULL,
  blueprint_id        BIGINT NOT NULL,
  print_provider_id   BIGINT NOT NULL,
  external_product_id TEXT,
  status              TEXT   NOT NULL DEFAULT 'pending',  -- pending | created | deleted | delete_failed | failed
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- designs & products

CREATE TABLE designs (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  bg_file    TEXT,
  bg_width   INTEGER,
  bg_height  INTEGER,
  fg_file    TEXT,
  fg_width   INTEGER,
  fg_height  INTEGER,
  settings   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id                BIGSERIAL PRIMARY KEY,
  design_id         BIGINT REFERENCES designs (id) ON DELETE SET NULL,
  platform          TEXT   NOT NULL,
  shop_id           TEXT   NOT NULL,
  external_id       TEXT,
  blueprint_id      BIGINT NOT NULL,
  print_provider_id BIGINT NOT NULL,
  title             TEXT   NOT NULL,
  description       TEXT   NOT NULL DEFAULT '',
  tags              TEXT[] NOT NULL DEFAULT '{}',
  positions         TEXT[] NOT NULL DEFAULT '{}',
  pricing           JSONB  NOT NULL DEFAULT '{}',   -- pricing rule used
  status            TEXT   NOT NULL DEFAULT 'pending', -- pending | rendering | uploading | created | published | failed
  error             TEXT,
  external_data     JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_design_idx ON products (design_id);

CREATE TABLE product_variants (
  product_id  BIGINT  NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id  BIGINT  NOT NULL,
  title       TEXT,
  price_cents INTEGER NOT NULL,
  cost_cents  INTEGER,
  is_enabled  BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (product_id, variant_id)
);

CREATE TABLE product_images (
  id                BIGSERIAL PRIMARY KEY,
  product_id        BIGINT  NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  position          TEXT    NOT NULL,
  width             INTEGER NOT NULL,
  height            INTEGER NOT NULL,
  variant_ids       BIGINT[] NOT NULL,
  file              TEXT    NOT NULL,
  external_image_id TEXT
);

-- ---------------------------------------------------------------- background jobs

CREATE TABLE jobs (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT  NOT NULL,
  params      JSONB NOT NULL DEFAULT '{}',
  status      TEXT  NOT NULL DEFAULT 'running',  -- running | done | failed | cancelled
  progress    JSONB NOT NULL DEFAULT '{}',
  log         TEXT[] NOT NULL DEFAULT '{}',
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
