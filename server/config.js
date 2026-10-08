import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const storageDir = path.resolve(ROOT_DIR, process.env.STORAGE_DIR || './storage');

export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/printify',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  storage: {
    root: storageDir,
    layers: path.join(storageDir, 'layers'),
    renders: path.join(storageDir, 'renders'),
  },
  printify: {
    token: process.env.PRINTIFY_TOKEN || '',
    defaultShopId: process.env.PRINTIFY_SHOP_ID || '',
    baseUrl: 'https://api.printify.com',
    userAgent: 'pod-studio/2.0',
  },
};
