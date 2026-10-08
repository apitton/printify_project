// Registry of print-on-demand platforms. To add one (Printful, Gelato, ...), create an adapter
// exposing the same methods as ./printify.js and register it here.
import { printify } from './printify.js';

const adapters = { [printify.platform]: printify };

export function getProvider(platform = 'printify') {
  const adapter = adapters[platform];
  if (!adapter) {
    const err = new Error(`Unknown platform "${platform}"`);
    err.status = 400;
    throw err;
  }
  return adapter;
}

export function listPlatforms() {
  return Object.values(adapters).map(a => ({ platform: a.platform, label: a.label }));
}
