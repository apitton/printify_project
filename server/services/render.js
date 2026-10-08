// Renders a design (back + front layer) at an exact print size using the shared layout.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { computeLayout, normalizeSettings } from '../../shared/layout.js';

// Large print files (e.g. 6000x6000+) are fine; just lift sharp's default pixel guard.
sharp.cache(false);
const MAX_PIXELS = 20000 * 20000;

export const layerPath = file => path.join(config.storage.layers, path.basename(file));

/**
 * @param {object} design row from `designs`
 * @param {{width:number, height:number}} size
 * @returns {Promise<Buffer>} PNG
 */
export async function renderDesign(design, { width, height }) {
  const settings = normalizeSettings(design.settings);
  const bg = design.bg_file ? { width: design.bg_width, height: design.bg_height } : null;
  const fg = design.fg_file ? { width: design.fg_width, height: design.fg_height } : null;
  const layout = computeLayout({ width, height }, bg, fg, settings);
  const W = layout.width, H = layout.height;

  const overlays = [];
  if (bg && layout.bgTiles.length) overlays.push({ input: await renderBackground(design, layout), left: 0, top: 0 });
  if (fg && layout.fg) {
    const r = layout.fg;
    let img = await sharp(layerPath(design.fg_file), { limitInputPixels: MAX_PIXELS })
      .resize(r.w, r.h, { fit: 'fill' })
      .png()
      .toBuffer();
    // Clip if an offset pushed the front layer partly outside the print area.
    const left = Math.max(0, r.x), top = Math.max(0, r.y);
    const cropW = Math.min(r.x + r.w, W) - left, cropH = Math.min(r.y + r.h, H) - top;
    if (cropW > 0 && cropH > 0) {
      if (left !== r.x || top !== r.y || cropW !== r.w || cropH !== r.h) {
        img = await sharp(img).extract({ left: left - r.x, top: top - r.y, width: cropW, height: cropH }).toBuffer();
      }
      overlays.push({ input: img, left, top });
    }
  }

  const background = settings.bgColor || { r: 0, g: 0, b: 0, alpha: 0 };
  return sharp({ create: { width: W, height: H, channels: 4, background }, limitInputPixels: MAX_PIXELS })
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Draws every tile on a canvas the size of the tiles' bounding box, then crops the target out of it.
async function renderBackground(design, layout) {
  const tiles = layout.bgTiles;
  const minX = Math.min(...tiles.map(t => t.x)), minY = Math.min(...tiles.map(t => t.y));
  const maxX = Math.max(...tiles.map(t => t.x + t.w)), maxY = Math.max(...tiles.map(t => t.y + t.h));
  const { w, h } = tiles[0];

  const src = sharp(layerPath(design.bg_file), { limitInputPixels: MAX_PIXELS }).resize(w, h, { fit: 'fill' });
  const variants = new Map();
  const tileImage = async (flipX, flipY) => {
    const key = `${flipX}${flipY}`;
    if (!variants.has(key)) {
      let s = src.clone();
      if (flipX) s = s.flop();
      if (flipY) s = s.flip();
      variants.set(key, await s.png().toBuffer());
    }
    return variants.get(key);
  };

  const composites = [];
  for (const t of tiles) composites.push({ input: await tileImage(t.flipX, t.flipY), left: t.x - minX, top: t.y - minY });

  const full = await sharp({
    create: { width: maxX - minX, height: maxY - minY, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    limitInputPixels: MAX_PIXELS,
  }).composite(composites).png().toBuffer();

  return sharp(full, { limitInputPixels: MAX_PIXELS })
    .extract({ left: -minX, top: -minY, width: layout.width, height: layout.height })
    .png()
    .toBuffer();
}

/** Renders (or reuses) the print file for a design at a size; returns its path on disk. */
export async function renderToFile(design, size) {
  const hash = crypto.createHash('sha1')
    .update(JSON.stringify([design.bg_file, design.fg_file, design.settings, design.updated_at]))
    .digest('hex').slice(0, 10);
  const file = path.join(config.storage.renders, `design${design.id}-${size.width}x${size.height}-${hash}.png`);
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(config.storage.renders, { recursive: true });
    await fs.writeFile(file, await renderDesign(design, size));
  }
  return file;
}

/**
 * Prepares a print file for upload. Printify recommends URL uploads above 5MB, so when
 * PUBLIC_BASE_URL is not set and the design is fully opaque (it has a back layer),
 * an oversized PNG is re-encoded as high-quality JPEG.
 */
export async function prepareUpload(design, file) {
  const fileName = path.basename(file);
  if (config.publicBaseUrl) return { fileName, url: `${config.publicBaseUrl}/files/renders/${fileName}` };
  let buffer = await fs.readFile(file);
  const opaque = Boolean(design.bg_file) || Boolean(design.settings?.bgColor);
  if (buffer.length > 5 * 1024 * 1024 && opaque) {
    buffer = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    return { fileName: fileName.replace(/\.png$/, '.jpg'), buffer };
  }
  return { fileName, buffer };
}
