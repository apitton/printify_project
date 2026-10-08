import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { normalizeSettings } from '../../shared/layout.js';
import { renderDesign } from '../services/render.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const layerFields = upload.fields([{ name: 'bg', maxCount: 1 }, { name: 'fg', maxCount: 1 }]);
export const router = Router();

// Stores an uploaded layer under a content hash and returns its file name + natural size.
async function saveLayer(file) {
  const meta = await sharp(file.buffer, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height) throw Object.assign(new Error(`${file.originalname} is not a readable image`), { status: 400 });
  const hash = crypto.createHash('sha1').update(file.buffer).digest('hex').slice(0, 16);
  const ext = (path.extname(file.originalname) || `.${meta.format}`).toLowerCase();
  const name = `${hash}${ext}`;
  await fs.mkdir(config.storage.layers, { recursive: true });
  await fs.writeFile(path.join(config.storage.layers, name), file.buffer);
  return { name, width: meta.width, height: meta.height };
}

function parseSettings(raw) {
  if (!raw) return undefined;
  try { return normalizeSettings(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return undefined; }
}

router.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT d.*, (SELECT count(*) FROM products p WHERE p.design_id = d.id)::int AS product_count
       FROM designs d ORDER BY d.updated_at DESC`,
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows: [d] } = await query('SELECT * FROM designs WHERE id=$1', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Design not found' });
  res.json(d);
});

router.post('/', layerFields, async (req, res) => {
  const bg = req.files?.bg?.[0] ? await saveLayer(req.files.bg[0]) : null;
  const fg = req.files?.fg?.[0] ? await saveLayer(req.files.fg[0]) : null;
  const { rows: [d] } = await query(
    `INSERT INTO designs (name, bg_file, bg_width, bg_height, fg_file, fg_width, fg_height, settings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.body.name || 'Untitled design', bg?.name, bg?.width, bg?.height, fg?.name, fg?.width, fg?.height,
      parseSettings(req.body.settings) || normalizeSettings()],
  );
  res.status(201).json(d);
});

router.put('/:id', layerFields, async (req, res) => {
  const { rows: [cur] } = await query('SELECT * FROM designs WHERE id=$1', [req.params.id]);
  if (!cur) return res.status(404).json({ error: 'Design not found' });
  const bg = req.files?.bg?.[0] ? await saveLayer(req.files.bg[0]) : null;
  const fg = req.files?.fg?.[0] ? await saveLayer(req.files.fg[0]) : null;
  const removeBg = req.body.removeBg === 'true', removeFg = req.body.removeFg === 'true';
  const pick = (layer, remove, key, prop) => (layer ? layer[prop] : remove ? null : cur[key]);
  const { rows: [d] } = await query(
    `UPDATE designs SET name=$2, bg_file=$3, bg_width=$4, bg_height=$5, fg_file=$6, fg_width=$7, fg_height=$8,
       settings=$9, updated_at=now() WHERE id=$1 RETURNING *`,
    [cur.id, req.body.name || cur.name,
      pick(bg, removeBg, 'bg_file', 'name'), pick(bg, removeBg, 'bg_width', 'width'), pick(bg, removeBg, 'bg_height', 'height'),
      pick(fg, removeFg, 'fg_file', 'name'), pick(fg, removeFg, 'fg_width', 'width'), pick(fg, removeFg, 'fg_height', 'height'),
      parseSettings(req.body.settings) || cur.settings],
  );
  res.json(d);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM designs WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

// Full-resolution render at any size, e.g. /api/designs/3/render?width=4500&height=5400&download=1
router.get('/:id/render', async (req, res) => {
  const { rows: [d] } = await query('SELECT * FROM designs WHERE id=$1', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Design not found' });
  const width = Math.round(Number(req.query.width)), height = Math.round(Number(req.query.height));
  if (!(width > 0 && height > 0 && width <= 20000 && height <= 20000)) {
    return res.status(400).json({ error: 'width and height must be between 1 and 20000' });
  }
  const png = await renderDesign(d, { width, height });
  res.type('png');
  if (req.query.download) {
    const safe = d.name.replace(/[^\w.-]+/g, '_');
    res.attachment(`${safe}-${width}x${height}.png`);
  }
  res.send(png);
});
