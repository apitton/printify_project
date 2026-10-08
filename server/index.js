import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config, ROOT_DIR } from './config.js';
import { migrate } from './db/migrate.js';
import { router as api } from './routes/api.js';
import { markInterruptedJobs } from './services/jobs.js';

await migrate();
await markInterruptedJobs();
await fs.mkdir(config.storage.layers, { recursive: true });
await fs.mkdir(config.storage.renders, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use('/api', api);
// Express 5 forwards async errors here.
app.use('/api', (err, _req, res, _next) => {
  const status = err.status || (err.name === 'ProviderError' ? 502 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.use('/shared', express.static(path.join(ROOT_DIR, 'shared')));
// Layers (for the editor preview) and print files (reachable through PUBLIC_BASE_URL for URL uploads).
app.use('/files/layers', express.static(config.storage.layers, { immutable: true, maxAge: '30d' }));
app.use('/files/renders', express.static(config.storage.renders));
app.use(express.static(path.join(ROOT_DIR, 'web')));

app.listen(config.port, '127.0.0.1', () => {
  console.log(`POD Studio running at http://localhost:${config.port}`);
  if (!config.printify.token) console.warn('PRINTIFY_TOKEN is not set: catalog and product features will fail');
});
