/**
 * Best-effort in-memory sliding-window limiter. Per instance (serverless!), so it is a
 * throttle, never the protection: the persisted lockout and the platform firewall are.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private checks = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now: number = Date.now()): { ok: boolean; retryAfter: number } {
    if (++this.checks % 500 === 0) this.prune(now);
    const since = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= this.limit) {
      const oldest = list[0] ?? now;
      this.hits.set(key, list);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { ok: true, retryAfter: 0 };
  }

  reset(): void {
    this.hits.clear();
  }

  private prune(now: number): void {
    const since = now - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > since);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}

export const publicReadLimiter = new RateLimiter(60, 60_000);
export const writeLimiter = new RateLimiter(60, 60_000);
export const loginLimiter = new RateLimiter(10, 60_000);
export const adminLoginLimiter = new RateLimiter(10, 60_000);
