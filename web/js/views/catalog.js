import { api } from '../api.js';
import { esc, fmtDate, guard, html, refreshStatus, state, watchJob } from '../app.js';

export async function renderCatalogView(root) {
  const status = await api.status();
  const c = status.counts;
  const el = html(`<div class="grid cols-2">
    <section class="panel stack">
      <h2>Catalog</h2>
      <p class="small muted">${c.blueprints} blueprints stored. Providers and variants of a blueprint are fetched the first time you open it.</p>
      <button class="syncCatalog">Sync blueprint list</button>

      <h2 style="margin-top:20px">Production costs</h2>
      <p class="small muted">Printify doesn't publish costs in its catalog. For each blueprint/provider, a temporary product is created
        in your shop to read the variant costs, then deleted immediately. Costs: ${c.variant_costs} variants across
        ${c.priced_pairs}/${c.known_pairs} known blueprint/provider pairs, last update ${fmtDate(c.last_cost_sync)}.</p>
      <div class="field"><label>Skip pairs updated less than N days ago</label><input type="number" class="maxAge" value="30" min="0" style="width:100px"></div>
      <div class="row">
        <button class="syncCart" ${state.cart.length ? '' : 'disabled'}>Sync selected products (${state.cart.length})</button>
        <button class="syncAll">Sync entire catalog</button>
      </div>
      <p class="small muted">The entire catalog means thousands of temporary products and takes hours at Printify's rate limits.
        Interrupted runs can be restarted: fresh pairs are skipped.</p>
      <div class="row"><button class="cleanup">Delete leftover price probes${c.leftover_probes ? ` (${c.leftover_probes})` : ''}</button></div>
      <p class="small muted">Shop used for probes: ${status.shopId ? esc(status.shopId) : '<span class="err">none, pick one in step 3</span>'}</p>
    </section>
    <section class="panel">
      <h2>Jobs</h2>
      <div class="current"></div>
      <table style="margin-top:12px"><thead><tr><th>#</th><th>Type</th><th>Status</th><th>Started</th><th>Finished</th></tr></thead><tbody class="jobs"></tbody></table>
    </section>
  </div>`);
  root.append(el);
  const $ = s => el.querySelector(s);

  async function loadJobs() {
    const jobs = await api.jobs();
    $('.jobs').innerHTML = '';
    for (const j of jobs) {
      const tr = html(`<table><tbody><tr class="clickable"><td>${j.id}</td><td>${esc(j.type)}</td>
        <td><span class="status ${esc(j.status)}">${esc(j.status)}</span></td>
        <td class="small">${fmtDate(j.started_at)}</td><td class="small">${fmtDate(j.finished_at)}</td></tr></tbody></table>`).querySelector('tr');
      tr.onclick = () => follow(j.id);
      $('.jobs').append(tr);
    }
    const running = jobs.find(j => j.status === 'running');
    if (running && !$('.current').children.length) follow(running.id);
  }
  const follow = id => watchJob($('.current'), id, { onDone: () => { loadJobs(); refreshStatus(); } });
  const start = (btn, fn) => guard(btn, async () => { const { jobId } = await fn(); follow(jobId); loadJobs(); });
  const maxAgeDays = () => Number($('.maxAge').value) || 0;

  $('.syncCatalog').onclick = e => start(e.target, api.syncCatalog);
  $('.syncCart').onclick = e => start(e.target, () => api.syncPrices({
    pairs: state.cart.map(i => ({ blueprintId: i.blueprintId, printProviderId: i.printProviderId })), maxAgeDays: maxAgeDays(),
  }));
  $('.syncAll').onclick = e => {
    if (!confirm('Fetch costs for the whole catalog? This creates and deletes thousands of temporary products and takes hours.')) return;
    start(e.target, () => api.syncPrices({ all: true, maxAgeDays: maxAgeDays() }));
  };
  $('.cleanup').onclick = e => start(e.target, api.cleanupProbes);

  await loadJobs();
}
