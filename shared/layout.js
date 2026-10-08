// Pure layout geometry shared by the browser preview (canvas) and the server renderer (sharp).
// Given the target print size and the natural sizes of the back/front layers, it returns
// where each piece must be drawn. Coordinates are in target pixels; tiles may extend
// outside the target and are clipped by the renderer.

export const BG_MODES = ['auto', 'cover', 'tile', 'stretch'];

export const DEFAULT_SETTINGS = Object.freeze({
  bgMode: 'auto',      // auto | cover | tile | stretch
  bgMirror: true,      // in tile mode, mirror every other tile so seams are invisible
  autoMaxCrop: 0.2,    // in auto mode, crop at most this share of the back layer before tiling instead
  fgScale: 0.9,        // front layer size relative to the largest size that fits (0..1+)
  fgOffsetX: 0,        // front layer offset, as a fraction of target width (-0.5..0.5)
  fgOffsetY: 0,        // front layer offset, as a fraction of target height
  bgColor: null,       // optional solid fill drawn under everything (e.g. '#ffffff')
});

export function normalizeSettings(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (!BG_MODES.includes(s.bgMode)) s.bgMode = DEFAULT_SETTINGS.bgMode;
  s.bgMirror = Boolean(s.bgMirror);
  for (const k of ['autoMaxCrop', 'fgScale', 'fgOffsetX', 'fgOffsetY']) {
    const n = Number(s[k]);
    s[k] = Number.isFinite(n) ? n : DEFAULT_SETTINGS[k];
  }
  return s;
}

/**
 * @param {{width:number,height:number}} target
 * @param {{width:number,height:number}|null} bg  natural size of the back layer
 * @param {{width:number,height:number}|null} fg  natural size of the front layer
 * @returns {{width, height, bgMode, bgTiles: Array<{x,y,w,h,flipX,flipY}>, fg: {x,y,w,h}|null}}
 */
export function computeLayout(target, bg, fg, settings = {}) {
  const s = normalizeSettings(settings);
  const W = Math.round(target.width);
  const H = Math.round(target.height);
  if (!(W > 0 && H > 0)) throw new Error('Target size must be positive');

  let bgTiles = [];
  let bgMode = null;
  if (bg && bg.width > 0 && bg.height > 0) {
    bgMode = resolveBgMode(W, H, bg, s);
    bgTiles = layoutBackground(W, H, bg, bgMode, s.bgMirror);
  }

  let fgRect = null;
  if (fg && fg.width > 0 && fg.height > 0) {
    const scale = Math.min(W / fg.width, H / fg.height) * s.fgScale;
    const w = Math.round(fg.width * scale);
    const h = Math.round(fg.height * scale);
    fgRect = {
      x: Math.round((W - w) / 2 + s.fgOffsetX * W),
      y: Math.round((H - h) / 2 + s.fgOffsetY * H),
      w, h,
    };
  }

  return { width: W, height: H, bgMode, bgTiles, fg: fgRect };
}

// "auto" = stretch proportionally to cover the target; if that would crop away too much of the
// back layer (very different aspect ratios, e.g. a square pattern on a mug wrap), tile it instead.
function resolveBgMode(W, H, bg, s) {
  if (s.bgMode !== 'auto') return s.bgMode;
  const cover = Math.max(W / bg.width, H / bg.height);
  const contain = Math.min(W / bg.width, H / bg.height);
  const croppedShare = 1 - contain / cover; // share of the back layer lost along one axis
  return croppedShare <= s.autoMaxCrop ? 'cover' : 'tile';
}

function layoutBackground(W, H, bg, mode, mirror) {
  if (mode === 'stretch') return [{ x: 0, y: 0, w: W, h: H, flipX: false, flipY: false }];

  if (mode === 'cover') {
    const scale = Math.max(W / bg.width, H / bg.height);
    const w = Math.round(bg.width * scale);
    const h = Math.round(bg.height * scale);
    return [{ x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, flipX: false, flipY: false }];
  }

  // tile: scale so the back layer exactly fills one axis, then repeat it along the other axis,
  // with one tile centred on the target so the composition stays symmetrical.
  const scale = Math.min(W / bg.width, H / bg.height);
  const w = Math.max(1, Math.round(bg.width * scale));
  const h = Math.max(1, Math.round(bg.height * scale));
  const x0 = Math.round((W - w) / 2);
  const y0 = Math.round((H - h) / 2);
  const tiles = [];
  const iMin = -Math.ceil(x0 / w), iMax = Math.ceil((W - x0 - w) / w);
  const jMin = -Math.ceil(y0 / h), jMax = Math.ceil((H - y0 - h) / h);
  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      tiles.push({
        x: x0 + i * w,
        y: y0 + j * h,
        w, h,
        flipX: mirror && Math.abs(i) % 2 === 1,
        flipY: mirror && Math.abs(j) % 2 === 1,
      });
    }
  }
  return tiles;
}
