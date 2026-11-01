import 'server-only';

/**
 * Per-instance sliding-window limiter for the public AI gateway. It bounds cost on one server
 * instance; it is not a distributed quota. The provider's own account limits remain the hard cap.
 */
export class RateLimiter {
    private readonly hits: number[] = [];
    constructor(private readonly windows: { windowMs: number; max: number }[], private readonly now = () => Date.now()) {}
    take(): boolean {
        const t = this.now(), longest = Math.max(...this.windows.map(w => w.windowMs));
        while (this.hits.length && this.hits[0] <= t - longest) this.hits.shift();
        if (this.windows.some(w => this.hits.filter(h => h > t - w.windowMs).length >= w.max)) return false;
        this.hits.push(t);
        return true;
    }
}
