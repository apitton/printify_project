import { api } from '../api.js';
import { esc, go, guard, html, save, state, toast } from '../app.js';
import { drawDesign, loadImage } from '../preview.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '/shared/layout.js';

const PRESETS = [
  { label: 'Square 4000×4000', width: 4000, height: 4000 },
  { label: 'T-shirt front 4500×5100', width: 4500, height: 5100 },
  { label: 'Mug 11oz wrap 2700×1100', width: 2700, height: 1100 },
  { label: 'Poster 18×24 5400×7200', width: 5400, height: 7200 },
  { label: 'Phone case 1500×2800', width: 1500, height: 2800 },
];

export async function renderDesignView(root) {
  const designs = await api.designs();
  let design = designs.find(d => d.id === state.designId) || null;
  // Unsaved edits
  let pending = { bgFile: null, fgFile: null, removeBg: false, removeFg: false };
  let settings = normalizeSettings(design?.settings);

  // Print sizes needed by the products already selected, so the preview shows real targets.
  const cartSizes = [];
  for (const item of state.cart) {
    for (const ph of item.placeholders || []) {
      if (!cartSizes.some(s => s.width === ph.width && s.height === ph.height)) {
        cartSizes.push({ label: `${item.blueprintTitle} · ${ph.position} ${ph.width}×${ph.height}`, width: ph.width, height: ph.height });
      }
    }
  }
  const sizes = [...cartSizes, ...PRESETS];
  let size = sizes[0];

  const el = html(`<div class="grid cols-2">
    <section class="panel">
      <div class="row spread"><h2>Designs</h2><button class="new">+ New</button></div>
      <ul class="list scroll designs"></ul>
    </section>
    <section class="grid" style="grid-template-columns: minmax(280px, 340px) 1fr; align-items: start">
      <div class="panel editor">
        <div class="field"><label>Name</label><input type="text" class="name" placeholder="e.g. Vintage coffee"></div>
        <div class="field">
          <label>Back layer (stretched / tiled to fill)</label>
          <input type="file" accept="image/*" class="bgFile">
          <div class="small muted bgInfo"></div>
        </div>
        <div class="field">
          <label>Front layer (centred, resized to fit)</label>
          <input type="file" accept="image/*" class="fgFile">
          <div class="small muted fgInfo"></div>
        </div>
        <hr style="border:none;border-top:1px solid var(--border)">
        <div class="field"><label>Back layer fill</label>
          <select class="bgMode">
            <option value="auto">Auto: stretch, tile when the shape differs a lot</option>
            <option value="cover">Stretch proportionally &amp; crop</option>
            <option value="tile">Tile (repeat)</option>
            <option value="stretch">Stretch (distort)</option>
          </select>
        </div>
        <div class="field"><label class="check"><input type="checkbox" class="bgMirror"> Mirror alternate tiles (seamless repeat)</label></div>
        <div class="field autoOnly"><label>Auto: max crop before tiling <span class="v-autoMaxCrop"></span></label>
          <input type="range" class="autoMaxCrop" min="0" max="0.6" step="0.05"></div>
        <div class="field"><label>Front layer size <span class="v-fgScale"></span></label>
          <input type="range" class="fgScale" min="0.1" max="1.2" step="0.01"></div>
        <div class="field"><label>Front horizontal offset <span class="v-fgOffsetX"></span></label>
          <input type="range" class="fgOffsetX" min="-0.5" max="0.5" step="0.01"></div>
        <div class="field"><label>Front vertical offset <span class="v-fgOffsetY"></span></label>
          <input type="range" class="fgOffsetY" min="-0.5" max="0.5" step="0.01"></div>
        <div class="field row"><label class="check"><input type="checkbox" class="useBgColor"> Solid colour under layers</label>
          <input type="color" class="bgColor" value="#ffffff"></div>
        <div class="row">
          <button class="primary save">Save design</button>
          <button class="reset">Reset settings</button>
          <button class="danger delete">Delete</button>
        </div>
      </div>
      <div class="panel">
        <div class="row spread">
          <div class="row" style="flex:1">
            <select class="size" style="max-width:340px"></select>
            <input type="number" class="w" style="width:90px" min="1"> × <input type="number" class="h" style="width:90px" min="1">
          </div>
          <div class="row">
            <button class="download">Download full size</button>
            <button class="primary next">Choose products →</button>
          </div>
        </div>
        <p class="small muted layoutInfo"></p>
        <div class="canvas-wrap"><canvas class="preview"></canvas></div>
        <div class="thumbs"></div>
      </div>
    </section>
  </div>`);
  root.append(el);
  const $ = s => el.querySelector(s);

  // ---------------------------------------------------------------- designs list
  function renderList() {
    const ul = $('.designs');
    ul.innerHTML = designs.length ? '' : '<li class="muted">No design yet: add layers and save.</li>';
    for (const d of designs) {
      const thumb = d.fg_file || d.bg_file;
      const li = html(`<li class="${d.id === design?.id ? 'selected' : ''}">
        ${thumb ? `<img src="/files/layers/${esc(thumb)}" alt="">` : '<span class="thumb"></span>'}
        <div><div>${esc(d.name)}</div><div class="small muted">${d.product_count} product(s)</div></div></li>`);
      li.onclick = () => select(d);
      ul.append(li);
    }
  }

  function select(d) {
    design = d;
    state.designId = d?.id ?? null;
    save();
    pending = { bgFile: null, fgFile: null, removeBg: false, removeFg: false };
    settings = normalizeSettings(d?.settings);
    $('.bgFile').value = '';
    $('.fgFile').value = '';
    fillForm();
    renderList();
    redraw();
  }

  // ---------------------------------------------------------------- form
  const sliders = ['autoMaxCrop', 'fgScale', 'fgOffsetX', 'fgOffsetY'];
  const pct = v => `${Math.round(v * 100)}%`;
  function fillForm() {
    $('.name').value = design?.name || '';
    $('.bgMode').value = settings.bgMode;
    $('.bgMirror').checked = settings.bgMirror;
    for (const k of sliders) { $(`.${k}`).value = settings[k]; $(`.v-${k}`).textContent = pct(settings[k]); }
    $('.useBgColor').checked = Boolean(settings.bgColor);
    if (settings.bgColor) $('.bgColor').value = settings.bgColor;
    $('.autoOnly').hidden = settings.bgMode !== 'auto';
    const info = (file, w, h, removed, newFile) => newFile ? `New: ${newFile.name} (unsaved)` : removed ? 'Removed (unsaved)' : file ? `${w}×${h}px · <button class="link rm">remove</button>` : 'None';
    $('.bgInfo').innerHTML = info(design?.bg_file, design?.bg_width, design?.bg_height, pending.removeBg, pending.bgFile);
    $('.fgInfo').innerHTML = info(design?.fg_file, design?.fg_width, design?.fg_height, pending.removeFg, pending.fgFile);
    $('.bgInfo .rm')?.addEventListener('click', () => { pending.removeBg = true; fillForm(); redraw(); });
    $('.fgInfo .rm')?.addEventListener('click', () => { pending.removeFg = true; fillForm(); redraw(); });
    $('.delete').hidden = !design;
  }

  function readForm() {
    settings = normalizeSettings({
      bgMode: $('.bgMode').value,
      bgMirror: $('.bgMirror').checked,
      ...Object.fromEntries(sliders.map(k => [k, Number($(`.${k}`).value)])),
      bgColor: $('.useBgColor').checked ? $('.bgColor').value : null,
    });
    for (const k of sliders) $(`.v-${k}`).textContent = pct(settings[k]);
    $('.autoOnly').hidden = settings.bgMode !== 'auto';
    redraw();
  }
  el.querySelectorAll('.editor select, .editor input[type=range], .editor input[type=checkbox], .editor input[type=color]')
    .forEach(i => i.addEventListener('input', readForm));
  $('.bgFile').onchange = e => { pending.bgFile = e.target.files[0] || null; pending.removeBg = false; fillForm(); redraw(); };
  $('.fgFile').onchange = e => { pending.fgFile = e.target.files[0] || null; pending.removeFg = false; fillForm(); redraw(); };
  $('.reset').onclick = () => { settings = normalizeSettings(DEFAULT_SETTINGS); fillForm(); redraw(); };

  // ---------------------------------------------------------------- preview
  const objectUrls = new Map();
  const srcFor = (file, layer) => {
    if (file) {
      if (!objectUrls.has(file)) objectUrls.set(file, URL.createObjectURL(file));
      return objectUrls.get(file);
    }
    return layer ? `/files/layers/${layer}` : null;
  };
  async function layers() {
    const bgSrc = pending.removeBg ? null : srcFor(pending.bgFile, design?.bg_file);
    const fgSrc = pending.removeFg ? null : srcFor(pending.fgFile, design?.fg_file);
    return Promise.all([loadImage(bgSrc), loadImage(fgSrc)]);
  }

  let drawSeq = 0;
  async function redraw() {
    const seq = ++drawSeq;
    let bg, fg;
    try { [bg, fg] = await layers(); } catch (err) { return toast(err.message, true); }
    if (seq !== drawSeq) return;
    const layout = drawDesign($('.preview'), { bg, fg, settings, width: size.width, height: size.height, maxPx: 560 });
    $('.layoutInfo').textContent = !bg && !fg ? 'Add a back and/or front layer to start.'
      : `${size.width}×${size.height}px` + (layout.bgMode ? ` · back layer: ${layout.bgMode}${layout.bgMode === 'tile' ? ` (${layout.bgTiles.length} tiles)` : ''}` : '')
        + (layout.fg ? ` · front layer ${layout.fg.w}×${layout.fg.h}px` : '');

    const thumbs = $('.thumbs');
    thumbs.innerHTML = '';
    if (cartSizes.length > 1 && (bg || fg)) {
      for (const s of cartSizes) {
        const fig = html(`<figure><canvas></canvas><figcaption>${esc(s.width)}×${esc(s.height)}</figcaption></figure>`);
        drawDesign(fig.querySelector('canvas'), { bg, fg, settings, width: s.width, height: s.height, maxPx: 150 });
        fig.title = s.label;
        fig.onclick = () => setSize(s);
        thumbs.append(fig);
      }
    }
  }

  function setSize(s) {
    size = { ...s };
    $('.w').value = size.width;
    $('.h').value = size.height;
    const idx = sizes.findIndex(x => x.width === s.width && x.height === s.height);
    $('.size').value = idx >= 0 ? String(idx) : 'custom';
    redraw();
  }
  $('.size').innerHTML = sizes.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('') + '<option value="custom">Custom…</option>';
  $('.size').onchange = e => { if (e.target.value !== 'custom') setSize(sizes[Number(e.target.value)]); };
  const onCustom = () => {
    const w = Number($('.w').value), h = Number($('.h').value);
    if (w > 0 && h > 0) { size = { width: w, height: h }; $('.size').value = 'custom'; redraw(); }
  };
  $('.w').onchange = onCustom;
  $('.h').onchange = onCustom;

  // ---------------------------------------------------------------- actions
  $('.save').onclick = e => guard(e.target, async () => {
    const form = new FormData();
    form.append('name', $('.name').value.trim() || 'Untitled design');
    form.append('settings', JSON.stringify(settings));
    if (pending.bgFile) form.append('bg', pending.bgFile);
    if (pending.fgFile) form.append('fg', pending.fgFile);
    if (pending.removeBg) form.append('removeBg', 'true');
    if (pending.removeFg) form.append('removeFg', 'true');
    const saved = design ? await api.updateDesign(design.id, form) : await api.createDesign(form);
    const i = designs.findIndex(d => d.id === saved.id);
    saved.product_count = design?.product_count ?? 0;
    if (i >= 0) designs.splice(i, 1);
    designs.unshift(saved);
    select(saved);
    toast('Design saved');
  });

  $('.delete').onclick = e => guard(e.target, async () => {
    if (!design || !confirm(`Delete design "${design.name}"? Products already created are kept.`)) return;
    await api.deleteDesign(design.id);
    designs.splice(designs.findIndex(d => d.id === design.id), 1);
    select(null);
  });

  $('.new').onclick = () => select(null);

  $('.download').onclick = () => {
    if (!design) return toast('Save the design first', true);
    if (pending.bgFile || pending.fgFile || pending.removeBg || pending.removeFg) toast('Downloading the last saved version');
    window.open(api.renderUrl(design.id, size.width, size.height, true), '_blank');
  };

  $('.next').onclick = () => {
    if (!design) return toast('Save the design first', true);
    go('products');
  };

  fillForm();
  renderList();
  setSize(size);
  return () => objectUrls.forEach(u => URL.revokeObjectURL(u));
}
