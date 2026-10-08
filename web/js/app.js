import { api } from './api.js';
import { renderDesignView } from './views/design.js';
import { renderProductsView } from './views/products.js';
import { renderDetailsView } from './views/details.js';
import { renderCatalogView } from './views/catalog.js';
import { renderHistoryView } from './views/history.js';

// ------------------------------------------------------------------ state
// The working session (selected design, product list, listing details) is kept in
// localStorage so a page reload doesn't lose it. Everything durable lives in the DB.

const STORAGE_KEY = 'pod-studio.session.v1';
const defaults = () => ({
  designId: null,
  cart: [], // [{key, blueprintId, blueprintTitle, printProviderId, providerTitle, variantIds, positions, placeholders, title}]
  details: {
    titleTemplate: '{design} {product}',
    description: '',
    tags: '',
    pricing: { mode: 'multiplier', value: 2, includeShipping: false, roundTo99: true },
    publish: false,
  },
});

function load() {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return defaults(); }
}

export const state = load();
export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  updateCartBadge();
}

// ------------------------------------------------------------------ helpers

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Builds an element from an HTML string. */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${isError ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 3500);
}

/** Runs an async action, reporting errors as toasts and disabling the button meanwhile. */
export async function guard(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } catch (err) { console.error(err); toast(err.message, true); } finally { if (button) button.disabled = false; }
}

export const fmtDate = d => (d ? new Date(d).toLocaleString() : '—');

/**
 * Renders a live job panel into `container`, polling until the job finishes.
 * @returns {Promise<object>} the finished job
 */
export function watchJob(container, jobId, { onDone } = {}) {
  container.innerHTML = '';
  const panel = html(`<div class="stack">
      <div class="row spread"><strong>Job #${jobId}</strong><span class="status running">running</span></div>
      <div class="progress"><div style="width:0%"></div></div>
      <div class="small muted progress-text"></div>
      <div class="log"></div>
      <div class="row"><button class="cancel">Cancel</button></div>
    </div>`);
  container.append(panel);
  panel.querySelector('.cancel').onclick = () => api.cancelJob(jobId);

  return new Promise(resolve => {
    const tick = async () => {
      let job;
      try { job = await api.job(jobId); } catch (err) { toast(err.message, true); return setTimeout(tick, 3000); }
      const p = job.progress || {};
      const total = p.total ?? p.blueprints;
      const done = (p.done ?? p.blueprintsDone ?? 0) + (p.failed ?? 0);
      const pct = total ? Math.round((done / total) * 100) : job.status === 'running' ? 5 : 100;
      panel.querySelector('.progress > div').style.width = `${job.status === 'running' ? pct : 100}%`;
      const status = panel.querySelector('.status');
      status.textContent = job.status;
      status.className = `status ${job.status}`;
      const { result, ...rest } = p;
      panel.querySelector('.progress-text').textContent = Object.entries(rest).map(([k, v]) => `${k}: ${v}`).join(' · ');
      const log = panel.querySelector('.log');
      log.textContent = (job.log || []).join('\n') + (job.error ? `\nERROR: ${job.error}` : '');
      log.scrollTop = log.scrollHeight;
      if (job.status === 'running') return setTimeout(tick, 1500);
      panel.querySelector('.cancel').remove();
      onDone?.(job);
      resolve(job);
    };
    tick();
  });
}

// ------------------------------------------------------------------ routing

const views = {
  design: renderDesignView,
  products: renderProductsView,
  details: renderDetailsView,
  catalog: renderCatalogView,
  history: renderHistoryView,
};

let cleanup = null;
async function route() {
  const name = location.hash.slice(1) || 'design';
  const render = views[name] || views.design;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  if (typeof cleanup === 'function') cleanup();
  const root = document.getElementById('view');
  root.innerHTML = '';
  try {
    cleanup = await render(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="panel err">${esc(err.message)}</div>`;
  }
}

export const go = view => { location.hash = view; };

function updateCartBadge() {
  const b = document.getElementById('cartCount');
  b.hidden = !state.cart.length;
  b.textContent = state.cart.length;
}

async function refreshStatus() {
  const pill = document.getElementById('statusPill');
  try {
    const s = await api.status();
    const c = s.counts;
    pill.textContent = s.printifyTokenConfigured
      ? `${c.blueprints} blueprints · ${c.priced_pairs}/${c.known_pairs} priced · ${c.products} products`
      : 'PRINTIFY_TOKEN missing in .env';
    pill.classList.toggle('err', !s.printifyTokenConfigured);
    if (c.leftover_probes) pill.textContent += ` · ${c.leftover_probes} probe(s) to clean`;
  } catch (err) {
    pill.textContent = 'backend unreachable';
    pill.classList.add('err');
  }
}
export { refreshStatus };

window.addEventListener('hashchange', route);
updateCartBadge();
refreshStatus();
route();
