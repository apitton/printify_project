// Thin client for the backend. The browser never talks to Printify directly.

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${method} ${url} → ${res.status}`);
  return data;
}

const qs = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();

export const api = {
  status: () => request('GET', '/api/status'),
  shops: () => request('GET', '/api/shops'),
  setShop: shopId => request('PUT', '/api/settings/shop', { shopId }),

  designs: () => request('GET', '/api/designs'),
  design: id => request('GET', `/api/designs/${id}`),
  createDesign: form => request('POST', '/api/designs', form),
  updateDesign: (id, form) => request('PUT', `/api/designs/${id}`, form),
  deleteDesign: id => request('DELETE', `/api/designs/${id}`),
  renderUrl: (id, w, h, download) => `/api/designs/${id}/render?${qs({ width: w, height: h, download: download ? 1 : '' })}`,

  syncCatalog: () => request('POST', '/api/catalog/sync'),
  blueprints: params => request('GET', `/api/catalog/blueprints?${qs(params)}`),
  blueprint: id => request('GET', `/api/catalog/blueprints/${id}`),
  providerVariants: (id, ppId) => request('GET', `/api/catalog/blueprints/${id}/providers/${ppId}`),

  syncPrices: body => request('POST', '/api/prices/sync', body),
  cleanupProbes: () => request('POST', '/api/prices/cleanup', {}),

  createProducts: body => request('POST', '/api/products/batch', body),
  products: () => request('GET', '/api/products'),
  product: id => request('GET', `/api/products/${id}`),
  publishProduct: id => request('POST', `/api/products/${id}/publish`),

  jobs: () => request('GET', '/api/jobs'),
  job: id => request('GET', `/api/jobs/${id}`),
  cancelJob: id => request('POST', `/api/jobs/${id}/cancel`),
};
