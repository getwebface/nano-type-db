// Minimal security utilities used by the Durable Object.
// These implementations are intentionally small and dependency-free
// to keep the bundle size minimal while providing the expected API.

type LoggerMeta = Record<string, any>;

export class StructuredLogger {
  private meta: LoggerMeta;
  constructor(meta: LoggerMeta = {}) {
    this.meta = meta;
  }

  private output(level: string, msg: string, obj?: any) {
    const payload = { timestamp: Date.now(), level, msg, ...this.meta } as any;
    if (obj !== undefined) payload.data = obj;
    // Console methods are available in Workers environment
    if (level === 'error') console.error(JSON.stringify(payload));
    else if (level === 'warn') console.warn(JSON.stringify(payload));
    else console.log(JSON.stringify(payload));
  }

  info(msg: string, obj?: any) { this.output('info', msg, obj); }
  warn(msg: string, obj?: any) { this.output('warn', msg, obj); }
  error(msg: string, obj?: any) { this.output('error', msg, obj); }
  debug(msg: string, obj?: any) { this.output('debug', msg, obj); }
}

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private store: Map<string, number[]> = new Map();

  constructor(maxRequests: number = 100, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const arr = this.store.get(key) || [];
    // Remove old timestamps
    const filtered = arr.filter(ts => ts > windowStart);
    filtered.push(now);
    this.store.set(key, filtered);
    return filtered.length <= this.maxRequests;
  }
}

export class InputValidator {
  static sanitizeString(input: any, maxLen: number = 1024, allowNewlines: boolean = true): string {
    if (input == null) return '';
    let s = String(input);
    if (!allowNewlines) s = s.replace(/\r?\n/g, ' ');
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  static sanitizeIdentifier(input: any): string {
    if (input == null) return '';
    return String(input).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 255);
  }
}

export class MemoryTracker {
  private maxBytes: number;
  private used: number = 0;

  constructor(maxBytes: number = 10 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  canAdd(bytes: number): boolean {
    return (this.used + bytes) <= this.maxBytes;
  }

  add(bytes: number) {
    this.used += bytes;
  }

  remove(bytes: number) {
    this.used = Math.max(0, this.used - bytes);
  }

  getUsed() { return this.used; }
}

export default {};
