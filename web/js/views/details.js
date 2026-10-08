import { api } from '../api.js';
import { esc, guard, html, refreshStatus, save, state, toast, watchJob } from '../app.js';
import { computePrice, formatCents } from '/shared/pricing.js';

const titleFor = (item, design) => item.title?.trim()
  || state.details.titleTemplate.replaceAll('{design}', design?.name || '').replaceAll('{product}', item.blueprintTitle).replace(/\s+/g, ' ').trim();

export async function renderDetailsView(root) {
  if (!state.cart.length) {
    root.append(html(`<div class="panel empty">No product selected. <a href="#products">Choose products</a></div>`));
    return;
  }
  const [design, status] = await Promise.all([state.designId ? api.design(state.designId).catch(() => null) : null, api.status()]);
  const d = state.details;

  const el = html(`<div class="grid cols-2">
    <section class="panel">
      <h2>Listing details</h2>
      <div class="field"><label>Design</label>
        <div>${design ? `<strong>${esc(design.name)}</strong> <a href="#design" class="small">change</a>` : '<span class="err">No design selected</span> <a href="#design">choose one</a>'}</div></div>
      <div class="field"><label>Shop</label><select class="shop"><option value="">Loading shops…</option></select></div>
      <div class="field"><label>Default title (<code>{design}</code>, <code>{product}</code>)</label><input type="text" class="titleTemplate"></div>
      <div class="field"><label>Description (shared by all products; HTML allowed)</label><textarea class="description"></textarea></div>
      <div class="field"><label>Tags (comma separated)</label><input type="text" class="tags" placeholder="vintage, coffee lover, gift"></div>
      <h3>Pricing</h3>
      <div class="row field">
        <select class="mode" style="width:auto">
          <option value="multiplier">Cost ×</option>
          <option value="margin">Cost + margin</option>
          <option value="fixed">Fixed price</option>
        </select>
        <input type="number" class="value" step="0.01" min="0" style="width:110px">
      </div>
      <div class="field"><label class="check"><input type="checkbox" class="includeShipping"> Include US shipping in cost (free-shipping listings)</label></div>
      <div class="field"><label class="check"><input type="checkbox" class="roundTo99"> Round up to .99</label></div>
      <div class="field"><label class="check"><input type="checkbox" class="publish"> Publish to the shop's sales channel after creation</label></div>
      <div class="row"><button class="primary generate">Create ${state.cart.length} product(s)</button></div>
      <div class="job" style="margin-top:14px"></div>
    </section>
    <section class="panel">
      <h2>Products &amp; prices</h2>
      <div class="items"></div>
    </section>
  </div>`);
  root.append(el);
  const $ = s => el.querySelector(s);

  // ---------------------------------------------------------------- form ⇄ state
  $('.titleTemplate').value = d.titleTemplate;
  $('.description').value = d.description;
  $('.tags').value = d.tags;
  $('.mode').value = d.pricing.mode;
  $('.value').value = d.pricing.value;
  $('.includeShipping').checked = d.pricing.includeShipping;
  $('.roundTo99').checked = d.pricing.roundTo99;
  $('.publish').checked = d.publish;
  const read = () => {
    d.titleTemplate = $('.titleTemplate').value;
    d.description = $('.description').value;
    d.tags = $('.tags').value;
    d.pricing = { mode: $('.mode').value, value: Number($('.value').value), includeShipping: $('.includeShipping').checked, roundTo99: $('.roundTo99').checked };
    d.publish = $('.publish').checked;
    save();
    renderItems();
  };
  el.querySelectorAll('section:first-child input, section:first-child textarea, section:first-child select:not(.shop)')
    .forEach(i => i.addEventListener('input', read));

  guard(null, async () => {
    const shops = await api.shops();
    $('.shop').innerHTML = '<option value="">Select a shop…</option>'
      + shops.map(s => `<option value="${esc(s.id)}">${esc(s.title)} (${esc(s.channel)})</option>`).join('');
    $('.shop').value = status.shopId && shops.some(s => s.id === status.shopId) ? status.shopId : (shops.length === 1 ? shops[0].id : '');
    if ($('.shop').value && $('.shop').value !== status.shopId) await api.setShop($('.shop').value);
  });
  $('.shop').onchange = e => guard(null, () => api.setShop(e.target.value));

  // ---------------------------------------------------------------- per-product price tables
  const variantData = new Map(); // key -> variants
  await Promise.all(state.cart.map(async item => {
    try {
      const r = await api.providerVariants(item.blueprintId, item.printProviderId);
      const ids = new Set(item.variantIds);
      variantData.set(item.key, r.variants.filter(v => ids.has(v.id)));
    } catch (err) {
      variantData.set(item.key, { error: err.message });
    }
  }));

  function renderItems() {
    const box = $('.items');
    const open = new Set([...box.querySelectorAll('details[open]')].map(x => x.dataset.key));
    box.innerHTML = '';
    for (const item of state.cart) {
      const vs = variantData.get(item.key);
      let summary = '', rows = '';
      if (vs?.error) summary = `<span class="err">${esc(vs.error)}</span>`;
      else {
        const priced = vs.map(v => ({ ...v, price: v.cost_cents === null && d.pricing.mode !== 'fixed' ? null : computePrice(v.cost_cents, d.pricing, v.us_shipping_cents) }));
        const profits = priced.filter(v => v.price !== null && v.cost_cents !== null).map(v => v.price - v.cost_cents - (d.pricing.includeShipping ? v.us_shipping_cents || 0 : 0));
        const prices = priced.map(v => v.price).filter(p => p !== null);
        const missing = priced.filter(v => v.price === null).length;
        summary = prices.length ? `${formatCents(Math.min(...prices))} – ${formatCents(Math.max(...prices))}` : '';
        if (profits.length) summary += ` · profit ${formatCents(Math.min(...profits))} – ${formatCents(Math.max(...profits))}`;
        if (profits.some(p => p < 0)) summary += ' · <span class="err">some prices below cost</span>';
        if (missing) summary += ` · <span class="warn">${missing} without cost (fetched on creation)</span>`;
        rows = priced.map(v => {
          const profit = v.price !== null && v.cost_cents !== null ? v.price - v.cost_cents - (d.pricing.includeShipping ? v.us_shipping_cents || 0 : 0) : null;
          return `<tr><td>${esc(v.title)}</td><td class="num">${formatCents(v.cost_cents)}</td><td class="num">${formatCents(v.us_shipping_cents)}</td>
            <td class="num">${formatCents(v.price)}</td><td class="num ${profit < 0 ? 'err' : ''}">${formatCents(profit)}</td></tr>`;
        }).join('');
      }
      const div = html(`<div class="cart-item">
        <div class="field"><label>${esc(item.blueprintTitle)} · ${esc(item.providerTitle)} · ${item.variantIds.length} variants · ${esc(item.positions.join(', '))}</label>
          <input type="text" class="title" placeholder="${esc(titleFor({ ...item, title: '' }, design))}" value="${esc(item.title || '')}"></div>
        <details data-key="${esc(item.key)}" ${open.has(item.key) ? 'open' : ''}><summary class="small">Prices: ${summary}</summary>
          <table><thead><tr><th>Variant</th><th class="num">Cost</th><th class="num">US ship.</th><th class="num">Price</th><th class="num">Profit</th></tr></thead>
          <tbody>${rows}</tbody></table></details>
      </div>`);
      div.querySelector('.title').oninput = e => { item.title = e.target.value; save(); };
      box.append(div);
    }
  }
  renderItems();

  // ---------------------------------------------------------------- generate
  $('.generate').onclick = e => guard(e.target, async () => {
    if (!design) throw new Error('Select and save a design first');
    if (!$('.shop').value) throw new Error('Select a shop');
    if (!design.bg_file && !design.fg_file) throw new Error('The design has no layers');
    const tags = d.tags.split(',').map(t => t.trim()).filter(Boolean);
    const items = state.cart.map(item => ({
      blueprintId: item.blueprintId,
      printProviderId: item.printProviderId,
      variantIds: item.variantIds,
      positions: item.positions,
      title: titleFor(item, design),
      description: d.description,
      tags,
      pricing: d.pricing,
    }));
    if (items.some(i => !i.title)) throw new Error('Every product needs a title');
    const { jobId } = await api.createProducts({ designId: design.id, shopId: $('.shop').value, publish: d.publish, items });
    e.target.disabled = true;
    const job = await watchJob($('.job'), jobId);
    refreshStatus();
    const r = job.progress?.result;
    if (r && !r.failed) {
      state.cart = [];
      save();
      $('.job').append(html(`<p class="ok">All ${r.done} product(s) created. <a href="#history">See history</a> · <a href="#design">New design</a></p>`));
    } else if (r) {
      // Keep only the failed items so they can be retried.
      const failedTitles = new Set(r.products.filter(p => !p.ok).map(p => p.title));
      state.cart = state.cart.filter(item => failedTitles.has(titleFor(item, design)));
      save();
      $('.job').append(html(`<p class="warn">${r.done} created, ${r.failed} failed. Failed products remain selected; fix and retry.</p>`));
      toast(`${r.failed} product(s) failed`, true);
    }
  });
}

