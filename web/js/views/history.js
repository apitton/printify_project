import { api } from '../api.js';
import { esc, fmtDate, guard, html, toast } from '../app.js';
import { formatCents } from '/shared/pricing.js';

export async function renderHistoryView(root) {
  const products = await api.products();
  const el = html(`<section class="panel">
    <h2>Products created</h2>
    <table><thead><tr><th>#</th><th>Title</th><th>Design</th><th>Product</th><th class="num">Variants</th>
      <th class="num">From</th><th class="num">Min profit</th><th>Status</th><th>Platform id</th><th>Created</th><th></th></tr></thead>
    <tbody></tbody></table>
  </section>`);
  root.append(el);
  const tbody = el.querySelector('tbody');
  if (!products.length) tbody.innerHTML = '<tr><td colspan="11" class="empty">No product yet.</td></tr>';

  for (const p of products) {
    const tr = html(`<table><tbody><tr>
      <td>${p.id}</td>
      <td>${esc(p.title)}${p.error ? `<div class="small err">${esc(p.error)}</div>` : ''}</td>
      <td>${esc(p.design_name || '—')}</td>
      <td class="small">${esc(p.blueprint_title || p.blueprint_id)}<div class="muted">${esc(p.print_provider_title || p.print_provider_id)}</div></td>
      <td class="num">${p.variant_count}</td>
      <td class="num">${formatCents(p.min_price_cents)}</td>
      <td class="num">${formatCents(p.min_profit_cents)}</td>
      <td><span class="status ${esc(p.status)}">${esc(p.status)}</span></td>
      <td class="small">${esc(p.platform)} ${esc(p.external_id || '')}</td>
      <td class="small">${fmtDate(p.created_at)}</td>
      <td>${p.status === 'created' ? '<button class="publish">Publish</button>' : ''}</td>
    </tr></tbody></table>`).querySelector('tr');
    tr.querySelector('.publish')?.addEventListener('click', e => guard(e.target, async () => {
      await api.publishProduct(p.id);
      toast('Publish requested');
      tr.querySelector('.status').textContent = 'published';
      e.target.remove();
    }));
    tbody.append(tr);
  }
}
