// Long-running work (catalog/price sync, product batches) runs as a background job.
// State is persisted in the `jobs` table so the UI can poll it and history survives restarts.
import { query } from '../db/pool.js';

const running = new Map(); // id -> { cancelled }

/**
 * @param {string} type
 * @param {object} params
 * @param {(ctx: {id:number, log:(msg:string)=>Promise<void>, progress:(p:object)=>Promise<void>, cancelled:()=>boolean}) => Promise<any>} fn
 * @returns {Promise<number>} job id (returns immediately, work continues in background)
 */
export async function startJob(type, params, fn) {
  const { rows } = await query('INSERT INTO jobs (type, params) VALUES ($1, $2) RETURNING id', [type, params]);
  const id = rows[0].id;
  const state = { cancelled: false };
  running.set(id, state);

  const ctx = {
    id,
    cancelled: () => state.cancelled,
    log: async msg => {
      console.log(`[job ${id} ${type}] ${msg}`);
      await query('UPDATE jobs SET log = (log || $2::text)[greatest(1, cardinality(log) - 498):] WHERE id = $1', [id, `${new Date().toISOString().slice(11, 19)} ${msg}`]);
    },
    progress: async p => {
      await query('UPDATE jobs SET progress = progress || $2::jsonb WHERE id = $1', [id, JSON.stringify(p)]);
    },
  };

  (async () => {
    try {
      const result = await fn(ctx);
      await query(
        `UPDATE jobs SET status = $2, finished_at = now(), progress = progress || $3::jsonb WHERE id = $1`,
        [id, state.cancelled ? 'cancelled' : 'done', JSON.stringify(result ? { result } : {})],
      );
    } catch (err) {
      console.error(`[job ${id} ${type}] failed`, err);
      await query(`UPDATE jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [id, err.message]);
    } finally {
      running.delete(id);
    }
  })();

  return id;
}

export function cancelJob(id) {
  const state = running.get(Number(id));
  if (!state) return false;
  state.cancelled = true;
  return true;
}

export async function getJob(id) {
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listJobs(limit = 20) {
  const { rows } = await query(
    `SELECT id, type, params, status, progress, error, started_at, finished_at FROM jobs ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Jobs still marked running after a restart were interrupted.
export async function markInterruptedJobs() {
  await query(`UPDATE jobs SET status = 'failed', error = 'Interrupted by server restart', finished_at = now() WHERE status = 'running'`);
}
