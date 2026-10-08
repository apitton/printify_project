// Small fetch wrapper shared by provider clients: sliding-window rate limits + retries.

export class ProviderError extends Error {
  constructor(message, { status, body, platform } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.body = body;
    this.platform = platform;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class RateLimiter {
  /** @param {number} limit requests allowed per window  @param {number} windowMs */
  constructor(limit, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.stamps = [];
    this.queue = Promise.resolve();
  }

  // Serialised so concurrent callers can't all see a free slot at once.
  acquire() {
    const next = this.queue.then(async () => {
      for (;;) {
        const now = Date.now();
        while (this.stamps.length && now - this.stamps[0] >= this.windowMs) this.stamps.shift();
        if (this.stamps.length < this.limit) {
          this.stamps.push(now);
          return;
        }
        await sleep(this.windowMs - (now - this.stamps[0]) + 25);
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} [opts.method]
 * @param {object} [opts.headers]
 * @param {any} [opts.body]           JSON-serialisable body
 * @param {RateLimiter[]} [opts.limiters]
 * @param {string} [opts.platform]
 * @param {number} [opts.retries]
 */
export async function requestJson({ url, method = 'GET', headers = {}, body, limiters = [], platform, retries = 4 }) {
  for (let attempt = 0; ; attempt++) {
    for (const l of limiters) await l.acquire();
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      throw new ProviderError(`${method} ${url} failed: ${err.message}`, { platform });
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (res.ok) return data;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    const detail = typeof data === 'object' && data ? (data.message || data.error || JSON.stringify(data.errors || data)) : String(data || '');
    throw new ProviderError(`${method} ${new URL(url).pathname} → ${res.status}: ${String(detail).slice(0, 500)}`, {
      status: res.status, body: data, platform,
    });
  }
}
