// Canvas preview using the exact same layout maths as the server renderer.
import { computeLayout } from '/shared/layout.js';

const cache = new Map();
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!cache.has(src)) {
    cache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { cache.delete(src); reject(new Error(`Cannot load image ${src}`)); };
      img.src = src;
    }));
  }
  return cache.get(src);
}

/**
 * Draws the design into `canvas`, scaled so the longest side is at most `maxPx`.
 * @param {HTMLCanvasElement} canvas
 * @param {{bg:HTMLImageElement|null, fg:HTMLImageElement|null, settings:object, width:number, height:number, maxPx:number}} o
 */
export function drawDesign(canvas, { bg, fg, settings, width, height, maxPx = 520 }) {
  const k = Math.min(1, maxPx / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';

  const layout = computeLayout(
    { width, height },
    bg ? { width: bg.naturalWidth, height: bg.naturalHeight } : null,
    fg ? { width: fg.naturalWidth, height: fg.naturalHeight } : null,
    settings,
  );

  ctx.save();
  ctx.scale(k, k);
  if (settings?.bgColor) {
    ctx.fillStyle = settings.bgColor;
    ctx.fillRect(0, 0, width, height);
  }
  for (const t of layout.bgTiles) {
    ctx.save();
    ctx.translate(t.x + (t.flipX ? t.w : 0), t.y + (t.flipY ? t.h : 0));
    ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
    ctx.drawImage(bg, 0, 0, t.w, t.h);
    ctx.restore();
  }
  if (layout.fg) ctx.drawImage(fg, layout.fg.x, layout.fg.y, layout.fg.w, layout.fg.h);
  ctx.restore();
  return layout;
}
