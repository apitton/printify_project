import { api } from '../api.js';
import { esc, go, guard, html, save, state, toast, watchJob } from '../app.js';
import { formatCents } from '/shared/pricing.js';

export async function renderProductsView(root) {
  const el = html(`<div class="grid cols-3">
    <section class="panel">
      <h2>Catalog</h2>
      <div class="field"><input type="search" class="q" placeholder="Search: t-shirt, mug, poster, Gildan…"></div>
      <label class="check small"><input type="checkbox" class="onlyPriced"> Only blueprints with known prices</label>
      <p class="small muted count"></p>
      <ul class="list scroll results"></ul>
      <div class="row"><button class="more" hidden>Load more</button></div>
    </section>
    <section class="panel detail"><div class="empty">Pick a product type in the catalog.</div></section>
    <section class="panel">
      <div class="row spread"><h2>Selected products</h2><button class="primary next">Details →</button></div>
      <div class="cart"></div>
    </section>
  </div>`);
  root.append(el);
  const $ = s => el.querySelector(s);

  // ---------------------------------------------------------------- search
  let offset = 0, items = [], timer;
  async function search(reset = true) {
    if (reset) { offset = 0; items = []; }
    const r = await api.blueprints({ q: $('.q').value, onlyPriced: $('.onlyPriced').checked ? 1 : '', limit: 50, offset });
    items.push(...r.items);
    offset += r.items.length;
    $('.count').textContent = r.total ? `${r.total} product types` : 'No result. If the catalog is empty, sync it in "Catalog & prices".';
    $('.more').hidden = offset >= r.total;
    const ul = $('.results');
    ul.innerHTML = '';
    for (const b of items) {
      const li = html(`<li>${b.image ? `<img src="${esc(b.image)}" loading="lazy" alt="">` : '<span class="thumb"></span>'}
        <div><div>${esc(b.title)}</div><div class="small muted">${esc(b.brand)} ${esc(b.model)} · ${b.provider_count || '?'} providers
        ${b.min_cost_cents ? ` · from ${formatCents(b.min_cost_cents)}` : ''}</div></div></li>`);
      li.onclick = () => { ul.querySelectorAll('li').forEach(x => x.classList.remove('selected')); li.classList.add('selected'); showBlueprint(b.id); };
      ul.append(li);
    }
  }
  $('.q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => guard(null, search), 250); };
  $('.onlyPriced').onchange = () => guard(null, search);
  $('.more').onclick = e => guard(e.target, () => search(false));

  // ---------------------------------------------------------------- blueprint → providers
  async function showBlueprint(id) {
    const d = $('.detail');
    d.innerHTML = '<div class="empty">Loading providers…</div>';
    const bp = await guard(null, () => api.blueprint(id));
    if (!bp) { d.innerHTML = ''; return; }
    d.innerHTML = '';
    d.append(html(`<div>
      <div class="row" style="align-items:flex-start">
        ${bp.images?.[0] ? `<img class="thumb" style="width:90px;height:90px" src="${esc(bp.images[0])}" alt="">` : ''}
        <div style="flex:1"><h2>${esc(bp.title)}</h2><div class="small muted">${esc(bp.brand)} ${esc(bp.model)} · blueprint #${bp.id}</div></div>
      </div>
      <details class="small" style="margin:10px 0"><summary>Description</summary><div>${bp.description || ''}</div></details>
      <h3>Print providers</h3>
      <table><thead><tr><th>Provider</th><th>Location</th><th class="num">Cost</th><th class="num">US ship.</th><th></th></tr></thead><tbody></tbody></table>
      <div class="variants" style="margin-top:16px"></div>
    </div>`));
    const tbody = d.querySelector('tbody');
    for (const p of bp.providers) {
      const cost = p.min_cost_cents === null ? '<span class="muted">unknown</span>'
        : p.min_cost_cents === p.max_cost_cents ? formatCents(p.min_cost_cents) : `${formatCents(p.min_cost_cents)} – ${formatCents(p.max_cost_cents)}`;
      const tr = html(`<table><tbody><tr class="clickable">
        <td>${esc(p.title)}${p.cost_error ? `<div class="small err" title="${esc(p.cost_error)}">price sync failed</div>` : ''}</td>
        <td class="small muted">${esc(p.location?.country || '')}</td>
        <td class="num">${cost}</td>
        <td class="num">${formatCents(p.us_shipping_cents)}</td>
        <td><button class="link">choose</button></td></tr></tbody></table>`).querySelector('tr');
      tr.onclick = () => {
        tbody.querySelectorAll('tr').forEach(x => x.classList.remove('selected'));
        tr.classList.add('selected');
        showVariants(bp, p, d.querySelector('.variants'));
      };
      tbody.append(tr);
    }
    if (!bp.providers.length) tbody.innerHTML = '<tr><td colspan="5" class="muted">No provider</td></tr>';
  }

  // ---------------------------------------------------------------- provider → variants & positions
  async function showVariants(bp, provider, box) {
    box.innerHTML = '<div class="empty">Loading variants…</div>';
    const data = await guard(null, () => api.providerVariants(bp.id, provider.id));
    if (!data) { box.innerHTML = ''; return; }
    const variants = data.variants;
    const existing = state.cart.find(c => c.blueprintId === bp.id && c.printProviderId === provider.id);

    const optionKeys = [...new Set(variants.flatMap(v => Object.keys(v.options || {})))];
    const values = Object.fromEntries(optionKeys.map(k => [k, [...new Set(variants.map(v => v.options?.[k]).filter(Boolean))]]));
    const selectedValues = Object.fromEntries(optionKeys.map(k => [k, new Set(values[k])]));
    if (existing) {
      const keep = new Set(existing.variantIds);
      for (const k of optionKeys) selectedValues[k] = new Set(variants.filter(v => keep.has(v.id)).map(v => v.options?.[k]));
    }
    const allPositions = [...new Set(variants.flatMap(v => v.placeholders.map(p => p.position)))];
    const positions = new Set(existing?.positions || [allPositions.includes('front') ? 'front' : allPositions[0]].filter(Boolean));

    box.innerHTML = '';
    const ui = html(`<div class="stack">
      <h3>${esc(provider.title)} · ${variants.length} variants</h3>
      <div class="costNote small"></div>
      <div class="options"></div>
      <label class="check small"><input type="checkbox" class="inStock" checked> In-stock variants only</label>
      <div><label>Print positions (design is applied to each)</label><div class="chips positions"></div></div>
      <div class="small muted summary"></div>
      <div class="row"><button class="primary add">${existing ? 'Update selection' : 'Add to selected products'}</button></div>
    </div>`);
    box.append(ui);

    const costNote = ui.querySelector('.costNote');
    const missingCosts = variants.some(v => v.cost_cents === null);
    if (missingCosts) {
      costNote.innerHTML = `<span class="warn">Production costs not fetched yet for this provider.</span>
        <button class="link fetch">Fetch prices now</button> <span class="muted">(creates a temporary product in your shop, then deletes it)</span>
        <div class="job"></div>`;
      costNote.querySelector('.fetch').onclick = e => guard(e.target, async () => {
        const { jobId } = await api.syncPrices({ pairs: [{ blueprintId: bp.id, printProviderId: provider.id }], force: true });
        await watchJob(costNote.querySelector('.job'), jobId);
        showVariants(bp, provider, box);
      });
    } else {
      costNote.innerHTML = `<span class="muted">Costs fetched ${new Date(data.costsSyncedAt || variants[0]?.cost_fetched_at).toLocaleDateString()}</span>`;
    }

    const opts = ui.querySelector('.options');
    for (const k of optionKeys) {
      const group = html(`<div><div class="row spread"><label>${esc(k)} (${values[k].length})</label>
        <span class="small"><button class="link all">all</button> · <button class="link none">none</button></span></div>
        <div class="chips"></div></div>`);
      const chips = group.querySelector('.chips');
      const paint = () => chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', selectedValues[k].has(c.dataset.v)));
      for (const v of values[k]) {
        const chip = html(`<span class="chip" data-v="${esc(v)}">${esc(v)}</span>`);
        chip.onclick = () => { selectedValues[k].has(v) ? selectedValues[k].delete(v) : selectedValues[k].add(v); paint(); update(); };
        chips.append(chip);
      }
      group.querySelector('.all').onclick = () => { selectedValues[k] = new Set(values[k]); paint(); update(); };
      group.querySelector('.none').onclick = () => { selectedValues[k] = new Set(); paint(); update(); };
      paint();
      opts.append(group);
    }

    const posBox = ui.querySelector('.positions');
    for (const p of allPositions) {
      const chip = html(`<span class="chip" data-v="${esc(p)}">${esc(p)}</span>`);
      chip.onclick = () => { positions.has(p) ? positions.delete(p) : positions.add(p); chip.classList.toggle('on', positions.has(p)); update(); };
      chip.classList.toggle('on', positions.has(p));
      posBox.append(chip);
    }

    const selected = () => variants.filter(v =>
      (!ui.querySelector('.inStock').checked || v.in_stock) &&
      optionKeys.every(k => !v.options?.[k] || selectedValues[k].has(v.options[k])));
    const placeholdersOf = vs => {
      const out = [];
      for (const v of vs) for (const ph of v.placeholders) {
        if (positions.has(ph.position) && !out.some(o => o.position === ph.position && o.width === ph.width && o.height === ph.height)) {
          out.push({ position: ph.position, width: ph.width, height: ph.height });
        }
      }
      return out;
    };
    function update() {
      const vs = selected();
      const costs = vs.map(v => v.cost_cents).filter(c => c !== null);
      const phs = placeholdersOf(vs);
      ui.querySelector('.summary').innerHTML = `${vs.length} variant(s) selected`
        + (costs.length ? ` · cost ${formatCents(Math.min(...costs))} – ${formatCents(Math.max(...costs))}` : '')
        + (phs.length ? `<br>Print files: ${phs.map(p => `${esc(p.position)} ${p.width}×${p.height}`).join(', ')}` : '')
        + (vs.length > 100 ? '<br><span class="warn">More than 100 variants: Printify may reject the product.</span>' : '');
    }
    ui.querySelector('.inStock').onchange = update;
    update();

    ui.querySelector('.add').onclick = () => {
      const vs = selected();
      if (!vs.length) return toast('Select at least one variant', true);
      if (!positions.size) return toast('Select at least one print position', true);
      const item = {
        key: `${bp.id}-${provider.id}`,
        blueprintId: bp.id,
        blueprintTitle: bp.title,
        printProviderId: provider.id,
        providerTitle: provider.title,
        image: bp.images?.[0] || null,
        variantIds: vs.map(v => v.id),
        positions: [...positions],
        placeholders: placeholdersOf(vs),
        title: existing?.title || '',
      };
      const i = state.cart.findIndex(c => c.key === item.key);
      if (i >= 0) state.cart[i] = item; else state.cart.push(item);
      save();
      renderCart();
      toast(i >= 0 ? 'Selection updated' : 'Added');
    };
  }

  // ---------------------------------------------------------------- cart
  function renderCart() {
    const c = $('.cart');
    c.innerHTML = state.cart.length ? '' : '<div class="empty">Nothing selected yet.</div>';
    for (const item of state.cart) {
      const div = html(`<div class="cart-item"><div class="row spread" style="flex-wrap:nowrap">
          <div class="row" style="flex-wrap:nowrap">${item.image ? `<img class="thumb" src="${esc(item.image)}" alt="">` : ''}
          <div><div>${esc(item.blueprintTitle)}</div>
          <div class="small muted">${esc(item.providerTitle)} · ${item.variantIds.length} variants · ${esc(item.positions.join(', '))}</div></div></div>
          <button class="link danger rm">remove</button></div></div>`);
      div.querySelector('.rm').onclick = () => { state.cart = state.cart.filter(x => x.key !== item.key); save(); renderCart(); };
      c.append(div);
    }
  }
  $('.next').onclick = () => (state.cart.length ? go('details') : toast('Select at least one product', true));

  renderCart();
  await search();
}
