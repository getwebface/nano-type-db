/**
 * Security Utilities for Production-Ready nanotypeDB
 * 
 * This module provides:
 * - SQL injection prevention
 * - Input validation and sanitization
 * - Rate limiting utilities
 * - CSRF token generation/validation
 * - Security headers
 */

/**
 * Rate Limiter using sliding window algorithm
 * Tracks requests per time window to prevent abuse
 */
export class RateLimiter {
  private requests: Map<string, number[]>;
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.requests = new Map();
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a request should be allowed
   * @param key - Unique identifier (e.g., userId, IP address)
   * @returns true if request is allowed, false if rate limit exceeded
   */
  allow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create request history for this key
    let history = this.requests.get(key) || [];

    // Remove requests outside the current window
    history = history.filter(timestamp => timestamp > windowStart);

    // Check if limit is exceeded
    if (history.length >= this.maxRequests) {
      this.requests.set(key, history);
      return false;
    }

    // Add current request and allow it
    history.push(now);
    this.requests.set(key, history);
    return true;
  }

  /**
   * Cleanup old entries to prevent memory leaks
   * Should be called periodically
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, history] of this.requests.entries()) {
      const filtered = history.filter(timestamp => timestamp > windowStart);
      if (filtered.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, filtered);
      }
    }
  }

  /**
   * Get remaining requests for a key
   */
  remaining(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const history = (this.requests.get(key) || []).filter(
      timestamp => timestamp > windowStart
    );
    return Math.max(0, this.maxRequests - history.length);
  }
}

/**
 * SQL Query Sanitizer
 * Validates and sanitizes SQL queries to prevent injection attacks
 */
export class SQLSanitizer {
  // Dangerous SQL keywords that should not appear in user queries
  private static readonly DANGEROUS_KEYWORDS = [
    'DROP',
    'DELETE',
    'TRUNCATE',
    'ALTER',
    'CREATE',
    'EXEC',
    'EXECUTE',
    'UNION',
    '--',
    '/*',
    '*/',
    'xp_',
    'sp_',
  ];

  /**
   * Check if a SQL query contains dangerous patterns
   */
  static containsDangerousPatterns(sql: string): boolean {
    const upperSql = sql.toUpperCase();
    return this.DANGEROUS_KEYWORDS.some(keyword => 
      upperSql.includes(keyword)
    );
  }

  /**
   * Validate that a query is read-only (SELECT only)
   */
  static isReadOnly(sql: string): boolean {
    const trimmed = sql.trim().toUpperCase();
    return trimmed.startsWith('SELECT') && !this.containsDangerousPatterns(sql);
  }

  /**
   * Sanitize table name to prevent injection
   */
  static sanitizeTableName(tableName: string): string {
    // Only allow alphanumeric characters and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    return tableName;
  }

  /**
   * Validate and sanitize column names
   */
  static sanitizeColumnName(columnName: string): string {
    // Only allow alphanumeric characters, underscores, and dots (for table.column)
    if (!/^[a-zA-Z0-9_.]+$/.test(columnName)) {
      throw new Error(`Invalid column name: ${columnName}`);
    }
    return columnName;
  }

  /**
   * Safely inject room_id filter into SELECT query
   * Returns modified query and updated params array
   */
  static injectRoomIdFilter(
    query: string,
    roomId: string,
    params: any[]
  ): { query: string; params: any[] } {
    const upperQuery = query.toUpperCase();
    
    // Don't modify if already has room_id filter
    if (upperQuery.includes('ROOM_ID')) {
      return { query, params };
    }

    // Don't modify if not a SELECT query
    if (!upperQuery.trim().startsWith('SELECT')) {
      return { query, params };
    }

    // Only handle tasks table for now
    if (!upperQuery.includes('FROM TASKS')) {
      return { query, params };
    }

    const newParams = [roomId, ...params];
    let modifiedQuery = query;

    // Case 1: Query has WHERE clause
    if (upperQuery.includes('WHERE')) {
      // Find the WHERE position (case-insensitive)
      const whereMatch = /\bWHERE\b/i.exec(query);
      if (whereMatch) {
        const wherePos = whereMatch.index + 5; // 'WHERE' is 5 chars
        modifiedQuery = 
          query.slice(0, wherePos) + 
          ' room_id = ? AND' + 
          query.slice(wherePos);
      }
    }
    // Case 2: Query has ORDER BY but no WHERE
    else if (upperQuery.includes('ORDER BY')) {
      const orderByMatch = /\bORDER\s+BY\b/i.exec(query);
      if (orderByMatch) {
        modifiedQuery = 
          query.slice(0, orderByMatch.index) + 
          ' WHERE room_id = ? ' + 
          query.slice(orderByMatch.index);
      }
    }
    // Case 3: Query has GROUP BY but no WHERE
    else if (upperQuery.includes('GROUP BY')) {
      const groupByMatch = /\bGROUP\s+BY\b/i.exec(query);
      if (groupByMatch) {
        modifiedQuery = 
          query.slice(0, groupByMatch.index) + 
          ' WHERE room_id = ? ' + 
          query.slice(groupByMatch.index);
      }
    }
    // Case 4: Query has LIMIT but no WHERE/ORDER BY/GROUP BY
    else if (upperQuery.includes('LIMIT')) {
      const limitMatch = /\bLIMIT\b/i.exec(query);
      if (limitMatch) {
        modifiedQuery = 
          query.slice(0, limitMatch.index) + 
          ' WHERE room_id = ? ' + 
          query.slice(limitMatch.index);
      }
    }
    // Case 5: Simple SELECT without modifiers
    else {
      modifiedQuery = query.replace(
        /FROM\s+tasks/i,
        'FROM tasks WHERE room_id = ?'
      );
    }

    return { query: modifiedQuery, params: newParams };
  }
}

/**
 * Input Validator
 * Validates common input types to prevent injection and data corruption
 */
export class InputValidator {
  /**
   * Validate and sanitize string input
   * - Trims whitespace
   * - Enforces max length
   * - Removes null bytes and control characters
   */
  static sanitizeString(
    value: any,
    maxLength: number = 10000,
    required: boolean = false
  ): string {
    if (value === null || value === undefined) {
      if (required) {
        throw new Error('Required field is missing');
      }
      return '';
    }

    if (typeof value !== 'string') {
      value = String(value);
    }

    // Remove null bytes and control characters (except newlines and tabs)
    let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    // Enforce max length
    if (sanitized.length > maxLength) {
      throw new Error(`Input too long: maximum ${maxLength} characters`);
    }

    return sanitized;
  }

  /**
   * Validate integer with bounds checking
   */
  static validateInteger(
    value: any,
    min?: number,
    max?: number,
    required: boolean = false
  ): number | null {
    if (value === null || value === undefined || value === '') {
      if (required) {
        throw new Error('Required field is missing');
      }
      return null;
    }

    const num = typeof value === 'number' ? value : Number(value);

    if (!Number.isInteger(num) || isNaN(num)) {
      throw new Error('Invalid integer value');
    }

    if (min !== undefined && num < min) {
      throw new Error(`Value must be at least ${min}`);
    }

    if (max !== undefined && num > max) {
      throw new Error(`Value must be at most ${max}`);
    }

    return num;
  }

  /**
   * Validate float/number with bounds checking
   */
  static validateNumber(
    value: any,
    min?: number,
    max?: number,
    required: boolean = false
  ): number | null {
    if (value === null || value === undefined || value === '') {
      if (required) {
        throw new Error('Required field is missing');
      }
      return null;
    }

    const num = typeof value === 'number' ? value : Number(value);

    if (isNaN(num) || !isFinite(num)) {
      throw new Error('Invalid number value');
    }

    if (min !== undefined && num < min) {
      throw new Error(`Value must be at least ${min}`);
    }

    if (max !== undefined && num > max) {
      throw new Error(`Value must be at most ${max}`);
    }

    return num;
  }

  /**
   * Validate boolean value
   */
  static validateBoolean(
    value: any,
    required: boolean = false
  ): boolean | null {
    if (value === null || value === undefined) {
      if (required) {
        throw new Error('Required field is missing');
      }
      return null;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
    }

    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }

    throw new Error('Invalid boolean value');
  }

  /**
   * Validate array with type checking
   */
  static validateArray<T>(
    value: any,
    maxLength?: number,
    required: boolean = false
  ): T[] | null {
    if (value === null || value === undefined) {
      if (required) {
        throw new Error('Required field is missing');
      }
      return null;
    }

    if (!Array.isArray(value)) {
      throw new Error('Value must be an array');
    }

    if (maxLength !== undefined && value.length > maxLength) {
      throw new Error(`Array too long: maximum ${maxLength} elements`);
    }

    return value as T[];
  }

  /**
   * Validate JSON object with size limit
   */
  static validateJSON(
    value: any,
    maxSize: number = 100000,
    required: boolean = false
  ): any {
    if (value === null || value === undefined) {
      if (required) {
        throw new Error('Required field is missing');
      }
      return null;
    }

    const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);

    if (jsonStr.length > maxSize) {
      throw new Error(`JSON too large: maximum ${maxSize} bytes`);
    }

    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (e) {
      throw new Error('Invalid JSON format');
    }
  }
}

/**
 * Security Headers for HTTP responses
 */
export class SecurityHeaders {
  /**
   * Get recommended security headers for HTTP responses
   */
  static getHeaders(): Record<string, string> {
    return {
      // Prevent XSS attacks
      'X-Content-Type-Options': 'nosniff',
      
      // Prevent clickjacking
      'X-Frame-Options': 'DENY',
      
      // Enable browser XSS protection
      'X-XSS-Protection': '1; mode=block',
      
      // Referrer policy
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      
      // Permissions policy (formerly Feature-Policy)
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    };
  }

  /**
   * Get Content Security Policy header
   * Note: This is a strict CSP. Adjust as needed for your app.
   */
  static getCSP(): string {
    return [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'", // wasm-unsafe-eval needed for some bundlers
      "style-src 'self' 'unsafe-inline'", // unsafe-inline often needed for CSS-in-JS
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' wss: https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ');
  }

  /**
   * Apply security headers to a Response
   */
  static apply(response: Response): Response {
    const headers = new Headers(response.headers);
    
    for (const [key, value] of Object.entries(this.getHeaders())) {
      headers.set(key, value);
    }
    
    headers.set('Content-Security-Policy', this.getCSP());

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}

/**
 * Query Timeout Wrapper
 * Prevents long-running queries from blocking the system
 */
export class QueryTimeout {
  /**
   * Execute a function with a timeout
   * @param fn - Function to execute
   * @param timeoutMs - Timeout in milliseconds
   * @param timeoutMessage - Error message on timeout
   */
  static async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string = 'Operation timed out'
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      )
    ]);
  }
}

/**
 * Memory Limit Tracker
 * Prevents memory exhaustion from accumulated data
 */
export class MemoryTracker {
  private currentSize: number = 0;
  private readonly maxSize: number;

  constructor(maxSizeBytes: number) {
    this.maxSize = maxSizeBytes;
  }

  /**
   * Check if adding data would exceed memory limit
   */
  canAdd(sizeBytes: number): boolean {
    return this.currentSize + sizeBytes <= this.maxSize;
  }

  /**
   * Add to memory usage
   */
  add(sizeBytes: number): void {
    this.currentSize += sizeBytes;
  }

  /**
   * Remove from memory usage
   */
  remove(sizeBytes: number): void {
    this.currentSize = Math.max(0, this.currentSize - sizeBytes);
  }

  /**
   * Get current memory usage
   */
  getCurrentSize(): number {
    return this.currentSize;
  }

  /**
   * Get remaining capacity
   */
  getRemaining(): number {
    return Math.max(0, this.maxSize - this.currentSize);
  }

  /**
   * Check if memory is full
   */
  isFull(): boolean {
    return this.currentSize >= this.maxSize;
  }

  /**
   * Reset memory tracker
   */
  reset(): void {
    this.currentSize = 0;
  }
}
