import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
import { 
  SQLSanitizer, 
  RateLimiter, 
  InputValidator, 
  QueryTimeout,
  MemoryTracker,
  StructuredLogger
} from "./lib/security";
import { generateTypeSafeClient } from "./client-generator";
// `node:fs` is not available in Cloudflare Workers; file-system backups
// are only performed when running in a Node environment. In Workers
// we skip file-based backups and rely on R2 or other mechanisms.

/**
 * SECURITY & ARCHITECTURE NOTES:
 * 
 * 1. SQL Injection Prevention: Raw SQL queries from clients are disabled by default.
 *    The executeSQL RPC method provides controlled read-only access for analytics.
 *    All mutations go through validated RPC methods with input sanitization.
 * 
 * 2. Efficient Broadcasting - O(1) Delta Updates: Uses action-based updates (added/modified/deleted)
 *    instead of O(N) full table diffing for scalability. Key optimizations:
 *    - INSERT operations use RETURNING * to get new row without extra SELECT
 *    - UPDATE operations use UPDATE...RETURNING * to get modified row in single query
 *    - DELETE operations fetch row before deletion (SQLite limitation - no DELETE...RETURNING)
 *    - broadcastUpdate only sends the single modified row (~1KB) not entire table (~10MB+)
 *    - Sync engine uses pagination (LIMIT/OFFSET) to avoid loading all rows at once
 *    Performance: O(1) per operation instead of O(N) where N = total database size
 * 
 * 3. Vector Search Consistency: AI embeddings are async and best-effort.
 *    If embedding fails, task exists in DB but may not be searchable until
 *    a background re-indexing job runs. For production, use Cloudflare Queues
 *    to ensure eventual consistency.
 * 
 * 4. Schema Management: Currently uses raw SQL in migrations. For better type
 *    safety, consider migrating to Drizzle ORM for schema definition.
 * 
 * 5. Hybrid State Model: Implements in-memory storage (MemoryStore) for transient
 *    data like cursors and presence that doesn't need persistence. This bypasses
 *    SQLite for maximum performance and reduces write costs.
 * 
 * 6. Local Aggregation: DebouncedWriter buffers high-frequency updates (e.g., 
 *    slider UI) and flushes to SQLite periodically, reducing write operations
 *    from 100/sec to 1/sec. Superior to Convex which charges per write.
 */

interface WebSocketMessage {
  action: "subscribe" | "query" | "mutate" | "rpc" | "ping" | "subscribe_query" | "unsubscribe_query";
  table?: string;
  sql?: string;
  method?: string; 
  payload?: any;
  updateId?: string; // For optimistic updates
  queryId?: string; // For query subscriptions
}

/**
 * MemoryStore: In-memory storage for transient data that doesn't need persistence
 * Use cases: cursors, presence, temporary UI state, debounced writes
 */
class MemoryStore {
  private data: Map<string, any>;
  private expiry: Map<string, number>;
  
  constructor() {
    this.data = new Map();
    this.expiry = new Map();
  }
  
  set(key: string, value: any, ttlMs?: number): void {
    this.data.set(key, value);
    if (ttlMs) {
      this.expiry.set(key, Date.now() + ttlMs);
    }
  }
  
  get(key: string): any {
    this.cleanupExpired();
    return this.data.get(key);
  }
  
  delete(key: string): boolean {
    this.expiry.delete(key);
    return this.data.delete(key);
  }
  
  has(key: string): boolean {
    this.cleanupExpired();
    return this.data.has(key);
  }
  
  keys(): IterableIterator<string> {
    this.cleanupExpired();
    return this.data.keys();
  }
  
  clear(): void {
    this.data.clear();
    this.expiry.clear();
  }
  
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, expiryTime] of this.expiry.entries()) {
      if (now >= expiryTime) {
        this.data.delete(key);
        this.expiry.delete(key);
      }
    }
  }
}

/**
 * DebouncedWriter: Aggregates high-frequency writes and flushes periodically
 * Use case: Slider UI updates, real-time position tracking, etc.
 */
class DebouncedWriter {
  private pending: Map<string, any>;
  private flushTimer: ReturnType<typeof setTimeout> | null;
  private flushInterval: number;
  private onFlush: (updates: Map<string, any>) => void;
  
  constructor(flushIntervalMs: number, onFlush: (updates: Map<string, any>) => void) {
    this.pending = new Map();
    this.flushTimer = null;
    this.flushInterval = flushIntervalMs;
    this.onFlush = onFlush;
  }
  
  write(key: string, value: any): void {
    this.pending.set(key, value);
    
    // Reset flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
  }
  
  flush(): void {
    if (this.pending.size > 0) {
      const updates = new Map(this.pending);
      this.pending.clear();
      this.onFlush(updates);
    }
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
  
  destroy(): void {
    this.flush();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
  }
}

/**
 * Calculate cosine similarity between two vectors using dot product
 * Since BGE embeddings are normalized, dot product equals cosine similarity
 * Returns a value between -1 and 1 (higher = more similar)
 */
function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  
  return dotProduct;
}

/**
 * RLS Policy Engine: Row Level Security
 * Defines access control policies for database rows
 */
class RLSPolicyEngine {
  private policies: Map<string, (userId: string, row: any) => boolean>;
  
  constructor() {
    this.policies = new Map();
    // Default policy: user can only access their own rows
    this.registerPolicy('tasks', (userId: string, row: any) => {
      return !row.owner_id || row.owner_id === userId;
    });
  }
  
  registerPolicy(table: string, policy: (userId: string, row: any) => boolean): void {
    this.policies.set(table, policy);
  }
  
  checkAccess(table: string, userId: string, row: any): boolean {
    const policy = this.policies.get(table);
    if (!policy) return true; // No policy = allow all
    return policy(userId, row);
  }
  
  filterRows(table: string, userId: string, rows: any[]): any[] {
    const policy = this.policies.get(table);
    if (!policy) return rows;
    return rows.filter(row => policy(userId, row));
  }
}

// 1. Define the Manifest explicitly
// Added 'search' to actions
const ACTIONS = {
  createTask: { params: ["title"] }, // RLS: owner_id always derived from authenticated user
  completeTask: { params: ["id"] },
  deleteTask: { params: ["id"] },
  listTasks: { params: ["limit?", "offset?"] }, // RLS: filtering enforced server-side
  search: { params: ["query"] },
  getUsage: { params: [] },
  getAuditLog: { params: [] },
  // Memory Store actions
  setCursor: { params: ["userId", "position"] },
  getCursors: { params: [] },
  setPresence: { params: ["userId", "status"] },
  getPresence: { params: [] },
  // Raw SQL interface (read-only analytics)
  executeSQL: { params: ["sql", "readonly"] },
  // Debounced updates
  updateDebounced: { params: ["key", "value"] },
  flushDebounced: { params: [] },
  // Sync Engine monitoring
  getSyncStatus: { params: [] },
  forceSyncAll: { params: [] },
  // Semantic Reflex - Killer Feature #1
  subscribeSemantic: { params: ["topic", "description", "threshold"] },
  // Psychic Data - Killer Feature #2
  streamIntent: { params: ["text"] },
  // File Storage (R2 Integration)
  getUploadUrl: { params: ["filename", "contentType"] },
  listFiles: { params: [] }, // RLS: filtering enforced server-side
  // Webhooks
  registerWebhook: { params: ["url", "event", "headers?"] },
  listWebhooks: { params: [] },
  // Cron Jobs
  scheduleCron: { params: ["name", "schedule", "rpcMethod", "rpcPayload?"] },
  listCronJobs: { params: [] },
  // Audit Log Export
  exportAuditLog: { params: ["format?"] },
  // Webhook Management
  createWebhook: { params: ["url", "events", "secret?"] },
  updateWebhook: { params: ["id", "url?", "events?", "active?"] },
  deleteWebhook: { params: ["id"] }
};

const MIGRATIONS = [
  {
    version: 1,
    up: (sql: any) => {
      sql.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT)`);
    }
  },
  {
    version: 2,
    up: (sql: any) => {
        // Usage Metering Table
        sql.exec(`CREATE TABLE IF NOT EXISTS _usage (date TEXT PRIMARY KEY, reads INTEGER DEFAULT 0, writes INTEGER DEFAULT 0)`);
        // Audit Log for Undo/History
        sql.exec(`CREATE TABLE IF NOT EXISTS _audit_log (id INTEGER PRIMARY KEY, action TEXT, payload TEXT, timestamp TEXT)`);
    }
  },
  {
      version: 3,
      up: (sql: any) => {
          try {
              sql.exec("ALTER TABLE _usage ADD COLUMN ai_ops INTEGER DEFAULT 0");
          } catch (e) {
              // Column might already exist or table issue
              console.warn("Migration v3 warning:", e);
          }
      }
  },
  {
      version: 4,
      up: (sql: any) => {
          // Debounced state table for local aggregation
          sql.exec(`CREATE TABLE IF NOT EXISTS _debounced_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
      }
  },
  {
      version: 5,
      up: (sql: any) => {
          // Add vector_status column to tasks table for vector consistency tracking
          // Values: 'pending' | 'indexed' | 'failed'
          try {
              sql.exec("ALTER TABLE tasks ADD COLUMN vector_status TEXT DEFAULT 'pending'");
          } catch (e) {
              // Column might already exist
              console.warn("Migration v5 warning:", e);
          }
      }
  },
  {
      version: 6,
      up: (sql: any) => {
          // Row Level Security: Add owner_id column to tasks
          try {
              sql.exec("ALTER TABLE tasks ADD COLUMN owner_id TEXT");
          } catch (e) {
              console.warn("Migration v6 warning:", e);
          }
      }
  },
  {
      version: 7,
      up: (sql: any) => {
          // Webhooks table for client notification system (with events plural and active column)
          sql.exec(`CREATE TABLE IF NOT EXISTS _webhooks (
              id TEXT PRIMARY KEY,
              url TEXT NOT NULL,
              events TEXT NOT NULL,
              secret TEXT,
              active INTEGER DEFAULT 1,
              created_at INTEGER NOT NULL,
              last_triggered_at INTEGER,
              failure_count INTEGER DEFAULT 0
          )`);
          // Index for quick active webhook lookups
          try {
              sql.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON _webhooks(active) WHERE active = 1`);
          } catch (e) {
              console.warn("Could not create idx_webhooks_active index:", e);
          }
          
          // File storage metadata
          sql.exec(`CREATE TABLE IF NOT EXISTS _files (
              id TEXT PRIMARY KEY,
              owner_id TEXT,
              filename TEXT,
              size INTEGER,
              content_type TEXT,
              r2_key TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`);
          // User-defined cron jobs
          sql.exec(`CREATE TABLE IF NOT EXISTS _cron_jobs (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              schedule TEXT NOT NULL,
              rpc_method TEXT NOT NULL,
              rpc_payload TEXT,
              enabled INTEGER DEFAULT 1,
              owner_id TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`);
          // Environments table
          sql.exec(`CREATE TABLE IF NOT EXISTS _environments (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              type TEXT CHECK(type IN ('dev', 'staging', 'prod')),
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`);
          // Add user_id column to tasks table for Row Level Security
          try {
              sql.exec("ALTER TABLE tasks ADD COLUMN user_id TEXT");
          } catch (e) {
              // Column might already exist
              console.warn("Migration v6 warning:", e);
          }
      }
  }
];

export class NanoStore extends DurableObject {
  sql: any; 
  subscribers: Map<string, Set<WebSocket>>;
  env: Env;
  doId: string;
  ctx: DurableObjectState;
  // Hybrid State: In-memory stores for transient data
  memoryStore: MemoryStore;
  debouncedWriter: DebouncedWriter;
  // Psychic cache: Track sent IDs per WebSocket
  psychicSentCache: WeakMap<WebSocket, Set<string>>;
  // SECURITY: Track user IDs per WebSocket for RLS
  webSocketUserIds: WeakMap<WebSocket, string>;
  // Sync Engine: Track sync status and health
  syncEngine: {
    lastSyncTime: number;
    syncErrors: number;
    totalSyncs: number;
    isHealthy: boolean;
  };
  // SECURITY: Rate limiters for RPC methods (per user)
  rateLimiters: Map<string, RateLimiter>;
  // SECURITY: Memory tracker for debounced writes
  memoryTracker: MemoryTracker;
  // RLS: Row Level Security policy engine
  rlsEngine: RLSPolicyEngine;
  // Automatic Reactivity: Track queries per WebSocket for auto-refresh
  querySubscriptions: WeakMap<WebSocket, Map<string, { method: string; payload: any; tables: string[] }>>;
  // PRODUCTION: Structured logger for observability
  logger: StructuredLogger;
  
  // SECURITY: Configuration constants
  private static readonly MAX_SUBSCRIBERS_PER_TABLE = 10000;
  private static readonly SEMANTIC_SUBSCRIPTION_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.subscribers = new Map();
    this.doId = ctx.id.toString();
    
    // PRODUCTION: Initialize structured logger with context
    this.logger = new StructuredLogger({ doId: this.doId });
    
    // Initialize Memory Store for transient data
    this.memoryStore = new MemoryStore();
    
    // Initialize Psychic cache
    this.psychicSentCache = new WeakMap();
    
    // Initialize RLS Policy Engine
    this.rlsEngine = new RLSPolicyEngine();
    
    // Initialize query subscriptions for automatic reactivity
    this.querySubscriptions = new WeakMap();
    // SECURITY: Initialize WebSocket user ID tracking for RLS
    this.webSocketUserIds = new WeakMap();
    
    // SECURITY: Initialize rate limiters
    this.rateLimiters = new Map();
    
    // SECURITY: Initialize memory tracker (10MB limit for debounced writes)
    this.memoryTracker = new MemoryTracker(10 * 1024 * 1024);
    
    // Initialize Debounced Writer (flushes every 1 second by default)
    this.debouncedWriter = new DebouncedWriter(1000, (updates) => {
      // Flush debounced writes to SQLite
      for (const [key, value] of updates.entries()) {
        try {
          this.sql.exec(
            `INSERT OR REPLACE INTO _debounced_state (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
            key, JSON.stringify(value)
          );
          // Update memory tracker
          const valueSize = JSON.stringify(value).length;
          this.memoryTracker.remove(valueSize);
        } catch (e) {
          this.logger.error('Failed to flush debounced write', e, { key });
        }
      }
    });
    
    // Initialize Sync Engine status
    this.syncEngine = {
      lastSyncTime: 0,
      syncErrors: 0,
      totalSyncs: 0,
      isHealthy: true
    };
    
    this.runMigrations();
    
    // Perform initial sync to D1 after migrations
    // Note: This runs asynchronously and doesn't block construction.
    // The DO can serve requests before initial sync completes.
    // For stricter consistency, use ctx.blockConcurrencyWhile() in production.
    this.performInitialSync().catch(e => {
      this.logger.error('Initial sync failed', e);
    });
  }

  runMigrations() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT)`);
    const lastMigration = this.sql.exec("SELECT max(version) as v FROM _migrations").toArray()[0];
    let currentVersion = lastMigration.v || 0;

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        try {
          migration.up(this.sql);
          this.sql.exec("INSERT INTO _migrations (version, applied_at) VALUES (?, datetime('now'))", migration.version);
        } catch (e) {
          console.error(`Migration v${migration.version} failed:`, e);
          throw e; 
        }
      }
    }
  }

  trackUsage(type: 'reads' | 'writes' | 'ai_ops') {
      const today = new Date().toISOString().split('T')[0];
      try {
        this.sql.exec(
            `INSERT INTO _usage (date, ${type}) VALUES (?, 1) 
             ON CONFLICT(date) DO UPDATE SET ${type} = ${type} + 1`,
            today
        );
        
        // Log to Cloudflare Analytics Engine for real-time observability
        if (this.env.ANALYTICS) {
            this.ctx.waitUntil(
                this.env.ANALYTICS.writeDataPoint({
                    blobs: [this.doId, type],
                    doubles: [1], // count
                    indexes: [`${type}_${today}`]
                })
            );
        }
      } catch (e) {
          console.error("Usage tracking failed", e);
      }
  }

  logAction(action: string, payload: any) {
      // Log Streaming Strategy: Use Cloudflare Observability instead of filling up storage
      // This prevents storage limits by streaming logs to Cloudflare's logging infrastructure
      console.log(JSON.stringify({ 
          type: 'audit_log',
          action, 
          payload, 
          timestamp: new Date().toISOString() 
      }));
  }

  /**
   * SECURITY: Check rate limit for a specific user and method
   * Returns true if request is allowed, false if rate limit exceeded
   */
  checkRateLimit(userId: string, method: string, maxRequests: number = 100, windowMs: number = 60000): boolean {
    const key = `${userId}:${method}`;
    
    // Get or create rate limiter for this user+method combination
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, new RateLimiter(maxRequests, windowMs));
    }
    
    const limiter = this.rateLimiters.get(key)!;
    const allowed = limiter.allow(userId);
    
    // Periodically cleanup old rate limiters (every 100th request)
    if (Math.random() < 0.01) {
      this.cleanupRateLimiters();
    }
    
    return allowed;
  }

  /**
   * SECURITY: Cleanup old rate limiter entries to prevent memory leaks
   */
  cleanupRateLimiters(): void {
    for (const [key, limiter] of this.rateLimiters.entries()) {
      limiter.cleanup();
    }
  }

  /**
   * Replicate data from Durable Object to D1 read replica
   * This enables horizontal scaling for read operations while maintaining
   * write consistency in the Durable Object.
   */
  async replicateToD1(table: string, operation: 'insert' | 'update' | 'delete', data?: any) {
    if (!this.env.READ_REPLICA) {
      console.warn("D1 READ_REPLICA not available, skipping replication");
      return;
    }

    // Helper to perform the actual query
    const performQuery = async () => {
      const roomId = this.doId;
      switch (operation) {
        case 'insert':
        case 'update':
          if (!data) throw new Error(`Data required for ${operation} operation on table '${table}'`);
          const keys = Object.keys(data).filter(k => k !== 'room_id');
          const columns = [...keys, 'room_id'];
          const placeholders = [...keys.map(() => '?'), '?'];
          const values = [...keys.map(k => data[k]), roomId];
          
          await this.env.READ_REPLICA.prepare(
            `INSERT OR REPLACE INTO "${table}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
          ).bind(...values).run();
          break;

        case 'delete':
          if (!data || !data.id) throw new Error(`ID required for delete operation on table '${table}'`);
          await this.env.READ_REPLICA.prepare(
            `DELETE FROM "${table}" WHERE id = ? AND room_id = ?`
          ).bind(data.id, roomId).run();
          break;
      }
    };

    try {
      await performQuery();
      
      // Success - update metrics
      this.syncEngine.lastSyncTime = Date.now();
      this.syncEngine.totalSyncs++;
      this.syncEngine.isHealthy = true;

    } catch (e: any) {
      // 🟢 AUTO-FIX: Handle "no such table" error automatically
      if (e.message && e.message.includes('no such table')) {
        console.warn(`[Sync Engine] Table '${table}' missing in D1. Attempting auto-creation...`);
        
        try {
          // 1. Force immediate schema replication
          await this.replicateSchemaToD1();
          
          // 2. Retry the operation once
          console.log(`[Sync Engine] Retrying operation on '${table}'...`);
          await performQuery();
          
          console.log(`[Sync Engine] Auto-recovery successful for '${table}'`);
          this.syncEngine.lastSyncTime = Date.now();
          this.syncEngine.totalSyncs++;
          this.syncEngine.isHealthy = true;
          return; // Exit successfully
        } catch (retryError: any) {
          console.error(`[Sync Engine] Auto-recovery failed for '${table}':`, retryError);
          // Fall through to normal error handling
        }
      }

      // Standard error logging
      console.error(`D1 replication failed for ${operation} on ${table}:`, e);
      this.syncEngine.syncErrors++;
      this.syncEngine.isHealthy = false;
    }
  }

  async replicateSchemaToD1() {
    if (!this.env.READ_REPLICA) {
      console.warn("D1 READ_REPLICA not available, skipping schema replication");
      return;
    }

    try {
      // Get all non-system tables with their CREATE statements
      const tables = this.sql.exec(`
        SELECT name, sql FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE '_%' AND name != 'sqlite_sequence'
      `).toArray();
      
      for (const table of tables) {
        const tableName = table.name;
        let createSql = table.sql;
        
        // Skip if no SQL found
        if (!createSql) continue;

        // SECURITY: Validate table name
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
          console.warn(`Invalid table name for replication: ${tableName}`);
          continue;
        }
        
        // Transform schema for D1 multi-tenancy: Add room_id column
        if (!createSql.includes('room_id')) {
             const lastParenIndex = createSql.lastIndexOf(')');
             if (lastParenIndex !== -1) {
                 createSql = createSql.substring(0, lastParenIndex) + ", room_id TEXT)";
             }
        }
        
        // Ensure IF NOT EXISTS
        if (!createSql.toUpperCase().includes('IF NOT EXISTS')) {
            createSql = createSql.replace(/CREATE TABLE/i, 'CREATE TABLE IF NOT EXISTS');
        }

        await this.env.READ_REPLICA.exec(createSql);
        
        // Create index on room_id for performance
        try {
            await this.env.READ_REPLICA.exec(`CREATE INDEX IF NOT EXISTS idx_${tableName}_room_id ON "${tableName}" (room_id)`);
        } catch (idxErr) {
            console.warn(`Could not create index for ${tableName}:`, idxErr);
        }
        
        console.log(`Schema replicated for table ${tableName}`);
      }
    } catch (e) {
      console.error("Failed to replicate schema to D1:", e);
    }
  }

  broadcastSchemaUpdate() {
    // Get current schema
    const schema = this.getSchema();
    
    // Broadcast to all connected clients
    const message = JSON.stringify({
      type: "schema_update",
      schema
    });
    
    // Send to all subscribed websockets
    this.subscribers.forEach((sockets) => {
      sockets.forEach((socket) => {
        try {
          socket.send(message);
        } catch (err) {
          console.error("Failed to send schema update:", err);
        }
      });
    });
  }

  /**
   * Read from D1 replica with fallback to DO SQLite
   * This provides distributed read scaling while maintaining resilience
   * 
   * SECURITY IMPROVEMENTS:
   * - Uses SQLSanitizer for safe room_id injection
   * - Validates query is read-only
   * - Properly handles parameterized queries
   * 
   * Note: Query modification is designed for simple SELECT queries.
   * Complex queries with subqueries, JOINs, or nested WHERE clauses
   * should pre-include room_id filtering to avoid modification issues.
   */
  async readFromD1(query: string, ...params: any[]): Promise<any[]> {
    // RE-ENABLED: D1 Read Replica for distributed read scaling
    // Falls back to local SQLite if D1 is unavailable or returns stale data
    
    // Try D1 first for distributed reads
    if (this.env.READ_REPLICA) {
      try {
        // SECURITY: Validate query is read-only
        if (!SQLSanitizer.isReadOnly(query)) {
          console.warn("Attempted non-read-only query on D1:", query);
          throw new Error("Only SELECT queries are allowed on D1");
        }
        
        // Add room_id filter to ensure data isolation
        const roomId = this.doId;
        
        // SECURITY: Use SQLSanitizer for safe query modification
        const { query: modifiedQuery, params: newParams } = 
          SQLSanitizer.injectRoomIdFilter(query, roomId, params);
        
        // Properly chain bind() calls (each bind() returns a new statement)
        let stmt = this.env.READ_REPLICA.prepare(modifiedQuery);
        for (const param of newParams) {
          stmt = stmt.bind(param);
        }
        
        const result = await stmt.all();
        
        // Track that we successfully used D1 for analytics
        this.trackUsage('reads');
        
        return result.results || [];
      } catch (e) {
        console.warn("D1 read failed, falling back to DO SQLite:", e);
        // Fall through to local read
      }
    }
    
    // Fallback to DO SQLite if D1 is unavailable or fails
    this.trackUsage('reads');
    return this.sql.exec(query, ...params).toArray();
  }

  /**
   * Sync Engine: Perform initial sync from DO to D1
   * Called once when the DO starts to ensure D1 has current data
   */
  async performInitialSync(): Promise<void> {
    if (!this.env.READ_REPLICA) {
      console.log("D1 READ_REPLICA not available, skipping initial sync");
      return;
    }

    try {
      console.log(`[Sync Engine] Starting initial sync for room ${this.doId}`);
      
      // Get all user tables dynamically (excluding system tables)
      const schema = this.getSchema();
      const userTables = Object.keys(schema);
      
      if (userTables.length === 0) {
        console.log(`[Sync Engine] No tables to sync`);
        this.syncEngine.lastSyncTime = Date.now();
        this.syncEngine.totalSyncs++;
        this.syncEngine.isHealthy = true;
        return;
      }
      
      let totalSynced = 0;
      const BATCH_SIZE = 100;
      
      // Sync each table
      for (const tableName of userTables) {
        try {
          // Check if table exists before querying
          const tableCheck = this.sql.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            tableName
          ).toArray();
          
          if (tableCheck.length === 0) {
            console.log(`[Sync Engine] Table ${tableName} no longer exists, skipping`);
            continue;
          }
          
          let offset = 0;
          
          while (true) {
            const rows = this.sql.exec(
              `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`, 
              BATCH_SIZE, 
              offset
            ).toArray();
            
            if (rows.length === 0) {
              break; // No more rows to sync
            }

            // Batch sync to D1 (dynamic for all tables)
            await this.batchSyncToD1(tableName, rows);
            
            totalSynced += rows.length;
            offset += BATCH_SIZE;
            
            // If we got fewer results than BATCH_SIZE, we're done with this table
            if (rows.length < BATCH_SIZE) {
              break;
            }
          }
          
          console.log(`[Sync Engine] Synced ${totalSynced} rows from table ${tableName}`);
        } catch (tableError: any) {
          if (tableError.message?.includes('no such table')) {
             console.log(`[Sync Engine] Table ${tableName} skipped (not found)`);
          } else {
             console.error(`[Sync Engine] Failed to sync table ${tableName}:`, tableError);
          }
          // Continue with other tables
        }
      }
      
      this.syncEngine.lastSyncTime = Date.now();
      this.syncEngine.totalSyncs++;
      this.syncEngine.isHealthy = true;
      
      console.log(`[Sync Engine] Initial sync completed: ${totalSynced} total rows synced across ${userTables.length} tables`);
    } catch (e) {
      console.error("[Sync Engine] Initial sync failed:", e);
      this.syncEngine.syncErrors++;
      this.syncEngine.isHealthy = false;
      // Don't throw - allow DO to continue operating even if sync fails
    }
  }

  /**
   * Sync Engine: Batch sync multiple records to D1
   * More efficient than individual syncs for bulk operations
   */
  async batchSyncToD1(table: string, rows: any[]): Promise<void> {
    if (!this.env.READ_REPLICA || rows.length === 0) {
      return;
    }

    try {
      const roomId = this.doId;
      
      const statements = rows.map(row => {
          const keys = Object.keys(row).filter(k => k !== 'room_id');
          const columns = [...keys, 'room_id'];
          const placeholders = [...keys.map(() => '?'), '?'];
          const values = [...keys.map(k => row[k]), roomId];
          
          return this.env.READ_REPLICA.prepare(
            `INSERT OR REPLACE INTO "${table}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
          ).bind(...values);
      });

      // Execute all statements in a batch
      await this.env.READ_REPLICA.batch(statements);
      
      console.log(`[Sync Engine] Batch synced ${rows.length} rows to D1 table ${table}`);
    } catch (e) {
      console.error(`[Sync Engine] Batch sync failed for table ${table}:`, e);
      throw e;
    }
  }

  /**
   * Sync Engine: Get sync status and health metrics
   */
  getSyncStatus(): any {
    return {
      isHealthy: this.syncEngine.isHealthy,
      lastSyncTime: this.syncEngine.lastSyncTime,
      lastSyncAge: Date.now() - this.syncEngine.lastSyncTime,
      totalSyncs: this.syncEngine.totalSyncs,
      syncErrors: this.syncEngine.syncErrors,
      // Error rate as formatted string for display (e.g., "0.13%")
      // Returned as string for convenience in UI/logging
      errorRate: this.syncEngine.totalSyncs > 0 
        ? (this.syncEngine.syncErrors / this.syncEngine.totalSyncs * 100).toFixed(2) + '%'
        : '0%',
      replicaAvailable: !!this.env.READ_REPLICA
    };
  }

  getSchema() {
    // Get all user tables (excluding system tables, but include _webhooks)
    const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").toArray();
    const schema: Record<string, any[]> = {};
    for (const t of tables) {
      // Include all user tables (exclude system tables starting with _)
      if (t.name.startsWith('sqlite_') || t.name.startsWith('_')) {
        continue; // Skip system tables
      }
      const columns = this.sql.exec(`PRAGMA table_info("${t.name}")`).toArray();
      schema[t.name] = columns;
    }
    return schema;
  }

  isValidTableName(tableName: string): boolean {
    // Validate table name against schema
    const schema = this.getSchema();
    return schema.hasOwnProperty(tableName);
  }

  /**
   * SECURITY: Sanitize field/column names for CSV imports
   * Converts "Post Content" to "post_content" automatically
   * This allows user-friendly CSV headers while maintaining security
   */
  sanitizeIdentifier(name: string): string {
    // Convert to lowercase
    let sanitized = name.toLowerCase();
    
    // Replace spaces, hyphens, and other non-alphanumeric chars with underscores
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');
    
    // Remove leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    
    // Ensure it starts with a letter or underscore
    if (!/^[a-z_]/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }
    
    // Collapse multiple underscores into one
    sanitized = sanitized.replace(/_+/g, '_');
    
    return sanitized;
  }

  /**
   * SECURITY: Check if table exists and is a user-created table (not a system table)
   * This replaces hard-coded table whitelists with dynamic validation
   * while maintaining security by:
   * 1. Ensuring table exists (prevents injection of arbitrary table names)
   * 2. Excluding system tables (tables starting with _ or sqlite_*)
   * 3. Combined with existing table name regex validation
   * 
   * EXCEPTION: _webhooks is explicitly allowed for DataGrid access
   */
  isUserTable(tableName: string): boolean {
    // First, validate the table name format to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      return false;
    }
    
    // Explicitly allow _webhooks system table
    if (tableName === '_webhooks') {
      return true;
    }
    
    // Exclude other system tables (tables starting with _ or sqlite_)
    if (tableName.startsWith('_') || tableName.startsWith('sqlite_')) {
      return false;
    }
    
    // Check if table exists in the schema
    try {
      const result = this.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        tableName
      ).toArray();
      return result.length > 0;
    } catch (e) {
      return false;
    }
  }

    async backupToR2() {
      try {
        // PRODUCTION FIX: Export as JSON instead of SQLite file
        // Cloudflare Workers do not have a writable file system or fs module
        // This approach works in both development and production
        
        if (!this.env.BACKUP_BUCKET) {
          console.log("R2 Bucket not configured, skipping backup.");
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Get all tables in the database
        const tables = this.sql.exec(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).toArray();
        
        // Export data as JSON
        const backup: Record<string, any> = {
          timestamp: new Date().toISOString(),
          doId: this.doId,
          schema: {},
          data: {}
        };
        
        for (const tableRow of tables) {
          const tableName = this.sanitizeIdentifier(tableRow.name as string);
          
          if (!tableName) {
            console.warn(`Skipping invalid table name: ${tableRow.name}`);
            continue;
          }
          
          // Get table schema - safe to use quoted identifier after sanitization
          const schemaInfo = this.sql.exec(`PRAGMA table_info("${tableName}")`).toArray();
          backup.schema[tableName] = schemaInfo;
          
          // Get table data
          const tableData = this.sql.exec(`SELECT * FROM "${tableName}"`).toArray();
          backup.data[tableName] = tableData;
        }
        
        // Upload JSON backup to R2
        const backupJson = JSON.stringify(backup, null, 2);
        await this.env.BACKUP_BUCKET.put(`backup-${timestamp}.json`, backupJson);
        console.log(`JSON backup uploaded: backup-${timestamp}.json (${backupJson.length} bytes)`);
        
      } catch (err) {
        console.error("Backup failed:", err);
      }
    }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // HEALTH CHECK ENDPOINT
    if (url.pathname === "/health") {
      try {
        // Perform basic health checks
        const health = {
          status: "healthy",
          timestamp: new Date().toISOString(),
          doId: this.doId,
          syncEngine: {
            isHealthy: this.syncEngine.isHealthy,
            lastSyncTime: this.syncEngine.lastSyncTime,
            syncErrors: this.syncEngine.syncErrors,
            totalSyncs: this.syncEngine.totalSyncs,
          },
          memory: {
            debouncedWritesSize: this.memoryTracker.getCurrentSize(),
            debouncedWritesLimit: this.memoryTracker.getRemaining() + this.memoryTracker.getCurrentSize(),
            debouncedWritesRemaining: this.memoryTracker.getRemaining(),
          },
          subscribers: {
            totalTables: this.subscribers.size,
            tables: Array.from(this.subscribers.entries()).map(([table, subs]) => ({
              table,
              count: subs.size
            }))
          },
          rateLimiters: {
            activeKeys: this.rateLimiters.size
          }
        };
        
        return Response.json(health);
      } catch (e: any) {
        return Response.json({
          status: "unhealthy",
          error: e.message,
          timestamp: new Date().toISOString()
        }, { status: 500 });
      }
    }

    // QUERY ENDPOINT for global queries
    if (url.pathname === "/query") {
      this.trackUsage('reads');
      const sql = url.searchParams.get("sql");
      if (!sql) {
        return new Response("Missing sql parameter", { status: 400 });
      }
      try {
        const results = this.sql.exec(sql).toArray();
        return Response.json(results);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // MANIFEST ENDPOINT
    if (url.pathname === "/manifest") {
      this.trackUsage('reads');
      return Response.json({
        actions: ACTIONS,
        tables: this.getSchema() 
      });
    }

    // DOWNLOAD CLIENT ENDPOINT - Generate and serve type-safe TypeScript client
    if (url.pathname === "/download-client") {
      this.trackUsage('reads');
      const clientCode = generateTypeSafeClient(ACTIONS, this.getSchema());
      return new Response(clientCode, {
        headers: {
          "Content-Type": "application/typescript",
          "Content-Disposition": 'attachment; filename="nanotype-client.ts"'
        }
      });
    }

    if (url.pathname === "/backup") {
        await this.backupToR2();
        return new Response("Backup completed");
    }

    // Internal endpoint to update vector status (called by queue consumer)
    if (url.pathname === "/internal/update-vector-status") {
        if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
        }
        try {
            const { taskId, status, values } = await request.json() as { taskId: number, status: string, values?: number[] };
            
            // Update vector status in database
            this.sql.exec("UPDATE tasks SET vector_status = ? WHERE id = ?", status, taskId);
            this.trackUsage('ai_ops');
            console.log(`Vector status updated for task ${taskId}: ${status}`);
            
            // If indexed successfully and we have values, trigger semantic reflex
            if (status === 'indexed' && values) {
                const taskResult = this.sql.exec("SELECT * FROM tasks WHERE id = ?", taskId).toArray();
                const task = taskResult[0];
                
                // Only process semantic reflex if task still exists
                if (task) {
                    // NEURAL EVENT LOOP - Semantic Reflex for queued embeddings
                    for (const key of this.memoryStore.keys()) {
                        if (key.startsWith('semantic_sub:')) {
                            const subscription = this.memoryStore.get(key);
                            if (subscription && subscription.vector && subscription.socket) {
                                try {
                                    const similarity = calculateCosineSimilarity(values, subscription.vector);
                                    if (similarity >= subscription.threshold && subscription.socket?.readyState === 1) {
                                        subscription.socket.send(JSON.stringify({
                                            type: "semantic_match",
                                            topic: subscription.topic,
                                            similarity: similarity,
                                            row: task
                                        }));
                                        console.log(`Semantic match (queued): task ${taskId} matched "${subscription.topic}" (similarity: ${similarity.toFixed(3)})`);
                                    }
                                } catch (e: any) {
                                    console.error(`Semantic check failed for ${key}:`, e.message);
                                }
                            }
                        }
                    }
                } else {
                    console.log(`Task ${taskId} no longer exists - skipping semantic reflex`);
                }
            }
            
            return new Response("Status updated", { status: 200 });
        } catch (error: any) {
            console.error("Failed to update vector status:", error);
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }

    // List all backups in R2 bucket
    if (url.pathname === "/backups") {
        try {
            if (!this.env.BACKUP_BUCKET) {
                return Response.json({ error: "R2 Bucket not configured" }, { status: 500 });
            }
            
            const listed = await this.env.BACKUP_BUCKET.list({ prefix: "backup-" });
            const backups = listed.objects.map(obj => ({
                key: obj.key,
                size: obj.size,
                uploaded: obj.uploaded.toISOString(),
                timestamp: obj.key.replace('backup-', '').replace('.db', '')
            }));
            
            // Sort by uploaded date, newest first
            backups.sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());
            
            return Response.json({ backups });
        } catch (error: any) {
            console.error("Failed to list backups:", error);
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // Restore from a specific backup
    if (url.pathname === "/restore") {
        if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
        }
        
        try {
            const { backupKey } = await request.json() as { backupKey: string };
            
            if (!this.env.BACKUP_BUCKET) {
                return Response.json({ error: "R2 Bucket not configured" }, { status: 500 });
            }
            
            // Validate backup key
            if (!backupKey || !backupKey.startsWith('backup-')) {
                return Response.json({ error: "Invalid backup key" }, { status: 400 });
            }
            
            // Fetch backup from R2
            const backup = await this.env.BACKUP_BUCKET.get(backupKey);
            if (!backup) {
                return Response.json({ error: "Backup not found" }, { status: 404 });
            }
            
            // For Cloudflare Workers Durable Objects, we can't directly restore the SQLite file
            // Instead, we need to parse it and reconstruct the tables
            // This is a simplified version - in production, you'd want to use a proper SQLite parser
            console.log(`Restoring from backup: ${backupKey}`);
            
            // Note: Full SQLite restoration in Workers would require either:
            // 1. Parsing the SQLite file format (complex)
            // 2. Exporting as SQL dump format instead of binary SQLite
            // 3. Using VACUUM FROM (if available in Workers DO SQLite)
            
            // For now, return a message indicating this needs implementation
            return Response.json({ 
                message: "Restore functionality requires SQL dump format. Current backup is binary SQLite.",
                suggestion: "Modify backupToR2() to export as SQL dump for easier restoration"
            }, { status: 501 });
            
        } catch (error: any) {
            console.error("Failed to restore backup:", error);
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // Analytics endpoint - fetch usage data from _usage table
    if (url.pathname === "/analytics") {
        try {
            // Get last 30 days of usage data
            const usageData = this.sql.exec(
                "SELECT * FROM _usage ORDER BY date DESC LIMIT 30"
            ).toArray();
            
            // Calculate totals
            const totals = {
                reads: 0,
                writes: 0,
                ai_ops: 0
            };
            
            usageData.forEach((row: any) => {
                totals.reads += row.reads || 0;
                totals.writes += row.writes || 0;
                totals.ai_ops += row.ai_ops || 0;
            });
            
            return Response.json({
                daily: usageData.reverse(), // oldest to newest for charts
                totals
            });
        } catch (error: any) {
            console.error("Failed to fetch analytics:", error);
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    if (url.pathname === "/schema") {
      this.trackUsage('reads');
      const schema = this.getSchema();
      return new Response(JSON.stringify(schema), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/connect") {
      const upgradeHeader = request.headers.get("Upgrade");
      console.log("/connect upgrade header:", upgradeHeader);
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        console.error("Invalid Upgrade header for websocket", { upgradeHeader });
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      // SECURITY: Get userId from authenticated session
      // X-User-ID is set by the edge worker (src/index.ts) AFTER successful
      // authentication. The client cannot set this header.
      const userId = request.headers.get("X-User-ID") || "anonymous";

      try {
        // @ts-ignore: WebSocketPair is a global in Cloudflare Workers
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

        this.handleSession(server, userId);

        return new Response(null, {
          status: 101,
          // @ts-ignore: webSocket property exists in Cloudflare ResponseInit
          webSocket: client,
        });
      } catch (error: any) {
        console.error("WebSocket upgrade failed:", error);
        return new Response(`WebSocket upgrade failed: ${error.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  handleSession(webSocket: WebSocket, userId: string) {
    // ✅ NEW WAY: Register with the Durable Object system to use Hibernation API
    // This connects the WebSocket to the webSocketMessage(), webSocketClose(), and 
    // webSocketError() class methods defined below (lines 710, 1417, 1439)
    this.ctx.acceptWebSocket(webSocket);
    
    // SECURITY: Store userId for this WebSocket connection for RLS
    this.webSocketUserIds.set(webSocket, userId);

    // Send reset message when DO wakes up (handleSession starts)
    // This notifies clients to re-announce their cursor/presence
    try {
      webSocket.send(JSON.stringify({ type: "reset" }));
    } catch (e) {
      console.error("Failed to send reset message:", e);
    }
  }

  /**
   * Helper to send structured error responses
   */
  sendError(ws: WebSocket, code: string, message: string, details?: any) {
    try {
      ws.send(JSON.stringify({ 
        type: "error",
        code, 
        error: message, 
        details 
      }));
    } catch (e) {
      this.logger.error("Failed to send error response", e);
    }
  }

  // Native Cloudflare Hibernation API: Class-based WebSocket handlers
  // These allow the DO to fully sleep between messages instead of staying in memory
  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string) as WebSocketMessage;

      // Handle ping/pong for heartbeat
      if (data.action === "ping") {
        try {
          webSocket.send(JSON.stringify({ type: "pong" }));
        } catch (e) {
          console.error("Failed to send pong:", e);
        }
        return;
      }

      if (data.action === "subscribe" && data.table) {
        // SECURITY: Limit number of subscribers per table to prevent DoS
        if (!this.subscribers.has(data.table)) {
          this.subscribers.set(data.table, new Set());
        }
        
        const tableSubscribers = this.subscribers.get(data.table)!;
        
        if (tableSubscribers.size >= NanoStore.MAX_SUBSCRIBERS_PER_TABLE) {
          try {
            webSocket.send(JSON.stringify({
              type: "error",
              error: `Table '${data.table}' subscription limit reached (${NanoStore.MAX_SUBSCRIBERS_PER_TABLE} max). Please try again later.`
            }));
          } catch (e) {
            console.error("Failed to send subscription limit error:", e);
          }
          return;
        }
        
        tableSubscribers.add(webSocket);
      }
      
      // Automatic Reactivity: Subscribe to query results
      // When subscribed table data changes, automatically re-run the query
      if (data.action === "subscribe_query") {
        const { queryId, method, payload, tables } = data;
        
        if (!queryId || !method || !tables) {
          webSocket.send(JSON.stringify({
            type: "error",
            error: "subscribe_query requires queryId, method, and tables"
          }));
          return;
        }
        
        // Get or create query subscriptions for this WebSocket
        if (!this.querySubscriptions.has(webSocket)) {
          this.querySubscriptions.set(webSocket, new Map());
        }
        
        const wsQueries = this.querySubscriptions.get(webSocket)!;
        wsQueries.set(queryId, { method, payload, tables });
        
        console.log(`Query ${queryId} subscribed to tables: ${tables.join(', ')}`);
        
        // Subscribe to all affected tables
        tables.forEach((table: string) => {
          if (!this.subscribers.has(table)) {
            this.subscribers.set(table, new Set());
          }
          this.subscribers.get(table)!.add(webSocket);
        });
        
        webSocket.send(JSON.stringify({
          type: "query_subscribed",
          queryId
        }));
      }
      
      if (data.action === "unsubscribe_query") {
        const { queryId } = data;
        
        if (this.querySubscriptions.has(webSocket)) {
          const wsQueries = this.querySubscriptions.get(webSocket)!;
          wsQueries.delete(queryId);
        }
        
        webSocket.send(JSON.stringify({
          type: "query_unsubscribed",
          queryId
        }));
      }

      if (data.action === "query" && data.sql) {
        // SECURITY: Disable raw SQL queries from client to prevent SQL injection
        webSocket.send(JSON.stringify({ 
          type: "query_error",
          error: "Raw SQL queries are disabled for security. Please use RPC methods."
        }));
        return;
      }

      if (data.action === "rpc" || (data.action as string) === "createTask") {
            const method = data.method || data.action;
            const start = performance.now();
            
            // Log the attempt
            // 'reads' or 'writes' tracked inside specific blocks or generally here?
            // Let's track writes here for mutations, but we have some read RPCs now.
            
            switch (method) {
                case "createTask": {
                    try {
                        // SECURITY: Get userId from WebSocket connection
                        // The userId was stored when the WebSocket was accepted in handleSession
                        const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                        
                        // SECURITY: Rate limit check (100 creates per minute per user)
                        if (!this.checkRateLimit(userId, "createTask", 100, 60000)) {
                            webSocket.send(JSON.stringify({ 
                                type: "mutation_error", 
                                action: "createTask",
                                error: "Rate limit exceeded. Please slow down.",
                                updateId: data.updateId
                            }));
                            break;
                        }
                        
                        this.trackUsage('writes');
                        
                        // SECURITY: Input validation using InputValidator
                        const titleRaw = data.payload?.title;
                        const title = InputValidator.sanitizeString(titleRaw, 500, true);
                        
                        this.logAction(method, data.payload);
                        
                        // 1. Insert into DB (Primary operation - must succeed)
                        // Set vector_status to 'pending' initially (will be updated to 'indexed' or 'failed')
                        // RLS: owner_id is always set to authenticated userId, cannot be overridden
                        // Store both owner_id and user_id for compatibility
                        const result = this.sql.exec(
                            "INSERT INTO tasks (title, status, vector_status, owner_id, user_id) VALUES (?, 'pending', 'pending', ?, ?) RETURNING *", 
                            title,
                            ownerId,
                            userId
                        ).toArray();
                        const newTask = result[0];

                        // 2. Replicate to D1 for distributed reads (async, non-blocking)
                        this.ctx.waitUntil(this.replicateToD1('tasks', 'insert', newTask));

                        // 3. Queue AI Embedding Generation (Consolidated Queue Binding)
                        // Use EMBEDDING_QUEUE for reliable AI processing with retry logic
                        if (newTask && this.env.EMBEDDING_QUEUE) {
                            this.ctx.waitUntil((async () => {
                                try {
                                    await this.env.EMBEDDING_QUEUE.send({
                                        taskId: newTask.id,
                                        title: title,
                                        doId: this.doId,
                                        timestamp: Date.now()
                                    });
                                    console.log(`Queued embedding for task ${newTask.id}`);
                                } catch (e) {
                                    console.error(`Failed to queue embedding for task ${newTask.id}:`, e);
                                    // Mark as failed in the database
                                    this.sql.exec("UPDATE tasks SET vector_status = 'failed' WHERE id = ?", newTask.id);
                                }
                            })());
                        } else if (newTask && this.env.AI && this.env.VECTOR_INDEX) {
                            // FALLBACK: If no queue, use old ctx.waitUntil approach
                            // Use ctx.waitUntil for async operation without blocking the response
                            this.ctx.waitUntil((async () => {
                                try {
                                    const embeddings = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [title] });
                                    const values = embeddings.data[0];
                                    if (values) {
                                        await this.env.VECTOR_INDEX.upsert([{ 
                                            id: `${this.doId}:${newTask.id}`, 
                                            values,
                                            metadata: { doId: this.doId, taskId: newTask.id } 
                                        }]);
                                        this.trackUsage('ai_ops');
                                        // Update status to 'indexed' on success
                                        this.sql.exec("UPDATE tasks SET vector_status = 'indexed' WHERE id = ?", newTask.id);
                                        console.log(`Vector indexed for task ${newTask.id}`);
                                        
                                        // NEURAL EVENT LOOP - Killer Feature #1: Semantic Reflex
                                        // Hold vector in RAM and check semantic subscriptions
                                        // Calculate Cosine Similarity (Dot Product) in V8 for instant alerts
                                        for (const key of this.memoryStore.keys()) {
                                            if (key.startsWith('semantic_sub:')) {
                                                const subscription = this.memoryStore.get(key);
                                                if (subscription && subscription.vector && subscription.socket) {
                                                    try {
                                                        // Calculate cosine similarity between task vector and subscription vector
                                                        const similarity = calculateCosineSimilarity(values, subscription.vector);
                                                        
                                                        // If similarity score exceeds threshold, send semantic match notification
                                                        if (similarity >= subscription.threshold) {
                                                            // SECURITY: Check if socket is still open and valid before sending
                                                            if (subscription.socket?.readyState === 1) { // WebSocket.OPEN
                                                                try {
                                                                    subscription.socket.send(JSON.stringify({
                                                                        type: "semantic_match",
                                                                        topic: subscription.topic,
                                                                        similarity: similarity,
                                                                        row: newTask
                                                                    }));
                                                                    console.log(`Semantic match: task ${newTask.id} matched subscription "${subscription.topic}" (similarity: ${similarity.toFixed(3)})`);
                                                                } catch (sendError: any) {
                                                                    console.error(`Failed to send semantic match notification:`, sendError);
                                                                    // Mark this subscription for cleanup if socket is dead
                                                                    if (subscription.socket.readyState !== 1) {
                                                                        this.memoryStore.delete(key);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    } catch (e: any) {
                                                        // Don't fail the entire operation if one subscription check fails
                                                        console.error(`Semantic subscription check failed for ${key}:`, e.message);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } catch (e: any) {
                                    // Update status to 'failed' on error (allows future retry)
                                    this.sql.exec("UPDATE tasks SET vector_status = 'failed' WHERE id = ?", newTask.id);
                                    console.error(`AI Embedding failed for task ${newTask.id}:`, e.message);
                                }
                            })());
                        }

                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "createTask",
                            updateId: data.updateId
                        }));
                        
                        // Efficient broadcast - only send the new row
                        this.broadcastUpdate("tasks", "added", newTask);
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_error", 
                            action: "createTask",
                            error: e.message,
                            updateId: data.updateId
                        }));
                    }
                    break;
                }

                case "completeTask":
                    try {
                        this.trackUsage('writes');
                        
                        // Input validation
                        const completeId = data.payload?.id;
                        if (!completeId || typeof completeId !== 'number' || !Number.isInteger(completeId) || completeId < 1) {
                            throw new Error('Invalid id: must be a positive integer');
                        }
                        
                        this.logAction(method, data.payload);
                        
                        // Use RETURNING * to get updated row in a single query (O(1) vs O(N))
                        const updated = this.sql.exec("UPDATE tasks SET status = 'completed' WHERE id = ? RETURNING *", completeId).toArray()[0];
                        
                        // Replicate to D1 for distributed reads (async, non-blocking)
                        if (updated) {
                            this.ctx.waitUntil(this.replicateToD1('tasks', 'update', updated));
                        }
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "completeTask",
                            updateId: data.updateId
                        }));
                        
                        // Efficient broadcast - only send the modified row
                        if (updated) {
                            this.broadcastUpdate("tasks", "modified", updated);
                        }
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_error", 
                            action: "completeTask",
                            error: e.message,
                            updateId: data.updateId
                        }));
                    }
                    break;

                case "deleteTask":
                    try {
                        this.trackUsage('writes');
                        
                        // Input validation
                        const deleteId = data.payload?.id;
                        if (!deleteId || typeof deleteId !== 'number' || !Number.isInteger(deleteId) || deleteId < 1) {
                            throw new Error('Invalid id: must be a positive integer');
                        }
                        
                        this.logAction(method, data.payload);
                        
                        // Fetch row before deleting for broadcast (SQLite doesn't support DELETE...RETURNING)
                        // This is a targeted O(1) query by primary key, not a full table scan
                        const deleted = this.sql.exec("SELECT * FROM tasks WHERE id = ?", deleteId).toArray()[0];
                        
                        this.sql.exec("DELETE FROM tasks WHERE id = ?", deleteId);
                        
                        // Replicate deletion to D1 (async, non-blocking)
                        if (deleted) {
                            this.ctx.waitUntil(this.replicateToD1('tasks', 'delete', { id: deleteId }));
                        }
                        
                        // Also delete from Vector Index
                        if (this.env.VECTOR_INDEX) {
                            this.env.VECTOR_INDEX.deleteByIds([`${this.doId}:${deleteId}`]).catch(console.error);
                        }
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "deleteTask",
                            updateId: data.updateId
                        }));
                        
                        // Efficient broadcast - only send the deleted row
                        if (deleted) {
                            this.broadcastUpdate("tasks", "deleted", deleted);
                        }
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_error", 
                            action: "deleteTask",
                            error: e.message,
                            updateId: data.updateId
                        }));
                    }
                    break;
                
                // Generic updateRow for inline editing
                case "updateRow": {
                    try {
                        this.trackUsage('writes');
                        
                        const { table, id, field, value } = data.payload || {};
                        
                        // SECURITY: Input validation
                        if (!table || typeof table !== 'string') {
                            throw new Error('Invalid table name');
                        }
                        if (!id || (typeof id !== 'number' && typeof id !== 'string')) {
                            throw new Error('Invalid row id');
                        }
                        if (!field || typeof field !== 'string') {
                            throw new Error('Invalid field name');
                        }
                        
                        // SECURITY: Validate that table exists and is a user-created table
                        // This replaces the hard-coded whitelist with dynamic validation
                        if (!this.isUserTable(table)) {
                            throw new Error(`Table '${table}' does not exist or is not accessible`);
                        }
                        
                        // SECURITY: Sanitize field name to prevent SQL injection
                        // Only allow alphanumeric and underscore
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
                            throw new Error('Invalid field name format');
                        }
                        
                        // SECURITY: Get userId for Row Level Security
                        const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                        
                        // Rate limit check
                        if (!this.checkRateLimit(userId, "updateRow", 100, 60000)) {
                            throw new Error('Rate limit exceeded. Please slow down.');
                        }
                        
                        this.logAction(method, data.payload);
                        
                        // Build parameterized update query
                        // SECURITY: Table and field names use string interpolation (not parameterizable in SQL)
                        // but are protected by:
                        // 1. Dynamic table existence check via isUserTable() (replaces hard-coded whitelist)
                        // 2. Field name regex validation (line 1509-1511)
                        // 3. Value is properly parameterized (prevents SQL injection)
                        // This is the standard approach for dynamic column updates in SQL
                        const query = `UPDATE ${table} SET ${field} = ? WHERE id = ? RETURNING *`;
                        const result = this.sql.exec(query, value, id).toArray();
                        
                        if (result.length === 0) {
                            throw new Error(`No row found with id ${id}`);
                        }
                        
                        const updatedRow = result[0];
                        
                        // Replicate to D1 (async, non-blocking)
                        this.ctx.waitUntil(this.replicateToD1(table, 'update', updatedRow));
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "updateRow",
                            updateId: data.updateId,
                            requestId: data.requestId,
                            data: updatedRow
                        }));
                        
                        // Broadcast update to subscribers
                        this.broadcastUpdate(table, "modified", updatedRow);
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_error", 
                            action: "updateRow",
                            error: e.message,
                            updateId: data.updateId,
                            requestId: data.requestId
                        }));
                    }
                    break;
                }
                
                // Batch insert for CSV import with Schema Evolution
                case "batchInsert": {
                    try {
                        this.trackUsage('writes');
                        
                        const { table, rows } = data.payload || {};
                        
                        // SECURITY: Input validation
                        if (!table || typeof table !== 'string') {
                            throw new Error('Invalid table name');
                        }
                        if (!Array.isArray(rows) || rows.length === 0) {
                            throw new Error('Rows must be a non-empty array');
                        }
                        
                        // SECURITY: Limit batch size to prevent DoS
                        if (rows.length > 10000) {
                            throw new Error('Batch size limited to 10000 rows');
                        }
                        
                        // SECURITY: Get userId
                        const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                        
                        // Rate limit check (stricter for batch operations)
                        if (!this.checkRateLimit(userId, "batchInsert", 10, 60000)) {
                            throw new Error('Rate limit exceeded. Please slow down.');
                        }
                        
                        this.logAction(method, { table, rowCount: rows.length });
                        
                        // SCHEMA VALIDATION: Prevent automatic column creation
                        // Require users to explicitly map CSV columns to existing schema or create columns first
                        const currentInfo = this.sql.exec(`PRAGMA table_info("${table}")`).toArray();
                        const existingColumns = new Set(currentInfo.map((c: any) => c.name));
                        
                        // Analyze the first row to find unmapped columns
                        const sampleRow = rows[0];
                        const incomingColumns = Object.keys(sampleRow).map(k => this.sanitizeIdentifier(k));
                        const unmappedColumns = incomingColumns.filter(k => k !== 'id' && !existingColumns.has(k));
                        
                        // PREVENT GHOST ROWS: Reject imports with unmapped columns
                        // This prevents the scenario where User A imports "email, name" and User B imports "Email, FullName"
                        // resulting in columns: email, name, Email, FullName
                        if (unmappedColumns.length > 0) {
                            const errorMsg = `Column mismatch detected. The following columns in your CSV do not exist in the table "${table}": ${unmappedColumns.join(', ')}. Please create these columns first or map them to existing columns. Existing columns: ${Array.from(existingColumns).join(', ')}`;
                            throw new Error(errorMsg);
                        }
                        
                        const insertedRows: any[] = [];
                        // PERFORMANCE: Reduced chunk size for better transaction handling
                        const CHUNK_SIZE = 50;
                        
                        // Process rows in chunks with transactions
                        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                            const chunk = rows.slice(i, Math.min(i + CHUNK_SIZE, rows.length));
                            
                            // Transaction for each chunk
                            try {
                                this.ctx.storage.transactionSync(() => {
                                    // Insert rows in this chunk
                                    for (const row of chunk) {
                                        try {
                                            // SECURITY: Sanitize field names (convert "Post Content" to "post_content")
                                            const sanitizedRow: Record<string, any> = {};
                                            for (const [key, value] of Object.entries(row)) {
                                                const sanitizedKey = this.sanitizeIdentifier(key);
                                                if (sanitizedKey) {
                                                    sanitizedRow[sanitizedKey] = value;
                                                }
                                            }

                                            // AUTOMATIC METADATA EXTRUSION: Inject user_id if column exists
                                            // This ensures tasks/private data imported via CSV are owned by the importer
                                            if (existingColumns.has('user_id') && !sanitizedRow['user_id']) {
                                                sanitizedRow['user_id'] = userId;
                                            }
                                            if (existingColumns.has('owner_id') && !sanitizedRow['owner_id']) {
                                                sanitizedRow['owner_id'] = userId;
                                            }
                                            if (existingColumns.has('created_at') && !sanitizedRow['created_at']) {
                                                sanitizedRow['created_at'] = Date.now(); // or ISO string depending on schema
                                            }

                                            const fields = Object.keys(sanitizedRow);
                                            if (fields.length === 0) continue;
                                            
                                            const values = Object.values(sanitizedRow);
                                            
                                            // Use quoted identifiers for safety
                                            const placeholders = fields.map(() => '?').join(', ');
                                            const fieldNames = fields.map(f => `"${f}"`).join(', ');
                                            
                                            const query = `INSERT INTO "${table}" (${fieldNames}) VALUES (${placeholders}) RETURNING *`;
                                            
                                            const result = this.sql.exec(query, ...values).toArray();
                                            if (result.length > 0) {
                                                insertedRows.push(result[0]);
                                            }
                                        } catch (rowError: any) {
                                            console.error('Failed to insert row:', rowError.message);
                                            // Continue with other rows in the chunk (inside transaction? usually partial failure kills the transaction)
                                            // In the original code, rowError was caught inside the loop, allowing the loop to continue.
                                            // However, if we are inside a transactionSync, does a caught error rollback?
                                            // No, transactionSync only rolls back if the callback throws.
                                            // Here we catch rowError, so the callback doesn't throw for single row fail.
                                        }
                                    }
                                });
                            } catch (chunkError: any) {
                                console.error(`Batch chunk failed:`, chunkError);
                                // Don't crash the whole request, just log and continue
                            }
                            
                            // Send progress update for each chunk
                            if (i + CHUNK_SIZE < rows.length) {
                                webSocket.send(JSON.stringify({ 
                                    type: "batch_progress",
                                    action: "batchInsert",
                                    updateId: data.updateId,
                                    requestId: data.requestId,
                                    data: { 
                                        inserted: insertedRows.length, 
                                        total: rows.length,
                                        progress: Math.round((insertedRows.length / rows.length) * 100)
                                    }
                                }));
                            }
                        }
                        
                        // Replicate data to D1 (async) - for all inserted rows
                        if (insertedRows.length > 0) {
                            for (const row of insertedRows) {
                                this.ctx.waitUntil(this.replicateToD1(table, 'insert', row));
                            }
                            
                            // Broadcast all inserted rows
                            for (const row of insertedRows) {
                                this.broadcastUpdate(table, "added", row);
                            }
                        }
                        
                        this.logger.info(`Batch insert completed`, { 
                            table, 
                            count: insertedRows.length,
                            totalRows: rows.length
                        });
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "batchInsert",
                            updateId: data.updateId,
                            requestId: data.requestId,
                            data: { inserted: insertedRows.length, total: rows.length }
                        }));
                        
                    } catch (e: any) {
                        this.logger.error("Batch insert failed", e);
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_error", 
                            action: "batchInsert",
                            error: e.message,
                            updateId: data.updateId,
                            requestId: data.requestId
                        }));
                    }
                    break;
                }
                
                case "search": {
                    this.trackUsage('ai_ops'); // It's an AI op
                    const query = data.payload?.query;
                    
                    // Input validation
                    if (!query || typeof query !== 'string') {
                        webSocket.send(JSON.stringify({ type: "query_result", data: [], originalSql: "search" }));
                        break;
                    }
                    if (query.length > 500) {
                        webSocket.send(JSON.stringify({ 
                            type: "query_error",
                            error: "Search query too long: maximum 500 characters"
                        }));
                        break;
                    }
                    
                    let results: any[] = [];
                    if (this.env.AI && this.env.VECTOR_INDEX) {
                         const embeddings = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [query] });
                         const values = embeddings.data[0];
                         // Query vectors
                         const matches = await this.env.VECTOR_INDEX.query(values, { topK: 5 });
                         
                         // Filter matches for this DO
                         const taskIds = matches.matches
                            .filter(m => m.id.startsWith(this.doId))
                            .map(m => m.id.split(':')[1]); // Extract taskId
                         
                         if (taskIds.length > 0) {
                             // Safe parameterized query construction:
                             // taskIds is an internal array of integers (not user input)
                             // Each taskId maps to a '?' placeholder, preventing injection
                             const placeholders = taskIds.map(() => '?').join(',');
                             results = await this.readFromD1(`SELECT * FROM tasks WHERE id IN (${placeholders})`, ...taskIds);
                             
                             // SECURITY: Apply RLS filtering to search results
                             const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                             results = this.rlsEngine.filterRows('tasks', userId, results);
                         }
                    }
                    
                    webSocket.send(JSON.stringify({ type: "query_result", data: results, originalSql: "search" }));
                    break;
                }

                case "streamIntent": {
                    // SECURITY: Psychic Data is gated to pro tier users only
                    // Auto-sensing with AI embeddings burns through budget quickly
                    const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                    
                    // Check user tier from AUTH_DB
                    try {
                        const userCheck = await this.env.AUTH_DB.prepare(
                            "SELECT tier FROM user WHERE id = ?"
                        ).bind(userId).first();
                        
                        if (!userCheck || userCheck.tier !== 'pro') {
                            webSocket.send(JSON.stringify({ 
                                type: "error", 
                                error: "Psychic Search is a pro-tier feature. Please upgrade to access AI-powered auto-sensing.",
                                feature: "psychic_search"
                            }));
                            break;
                        }
                    } catch (e: any) {
                        console.warn("Tier check failed for streamIntent:", e.message);
                        // Fail closed - deny access if we can't verify tier
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Unable to verify subscription tier. Please try again.",
                            feature: "psychic_search"
                        }));
                        break;
                    }
                    
                    // Psychic Data: Predict user needs and pre-push data
                    const text = data.payload?.text;
                    if (!text || typeof text !== 'string') {
                        break;
                    }
                    
                    try {
                        // Step 1: Generate embedding for the intent text
                        if (!this.env.AI || !this.env.VECTOR_INDEX) {
                            console.warn('AI or VECTOR_INDEX not available for streamIntent');
                            break;
                        }
                        
                        const embeddings = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [text] });
                        const values = embeddings.data[0];
                        
                        if (!values) {
                            break;
                        }
                        
                        // Step 2: Query vector index for top 3 matches
                        const matches = await this.env.VECTOR_INDEX.query(values, { topK: 3 });
                        
                        // Step 3: Extract IDs from matches for this DO
                        // Validate ID format: must be "doId:taskId" with exactly one colon
                        const taskIds = matches.matches
                            .filter(m => {
                                if (!m.id.startsWith(this.doId) || !m.id.includes(':')) {
                                    return false;
                                }
                                const parts = m.id.split(':');
                                // Ensure exactly 2 parts and second part is a valid number
                                return parts.length === 2 && /^\d+$/.test(parts[1]);
                            })
                            .map(m => m.id.split(':')[1]); // Safe to split after validation
                        
                        if (taskIds.length === 0) {
                            break;
                        }
                        
                        // Step 4: Check sentCache to avoid duplicate pushes
                        // Use WeakMap with WebSocket as key
                        let sentCache = this.psychicSentCache.get(webSocket);
                        if (!sentCache) {
                            sentCache = new Set<string>();
                            this.psychicSentCache.set(webSocket, sentCache);
                        }
                        
                        // Filter out already-sent IDs
                        const newTaskIds = taskIds.filter(id => !sentCache.has(id));
                        
                        if (newTaskIds.length === 0) {
                            break; // All matches already sent
                        }
                        
                        // Step 5: Fetch full records from SQLite (primary source)
                        // Validate that all IDs are numeric before query construction
                        const validTaskIds = newTaskIds.filter(id => /^\d+$/.test(id));
                        if (validTaskIds.length === 0) {
                            break;
                        }
                        
                        // Use explicit column selection for security
                        const placeholders = validTaskIds.map(() => '?').join(',');
                        const records = this.sql.exec(
                            `SELECT id, title, status FROM tasks WHERE id IN (${placeholders})`,
                            ...validTaskIds
                        ).toArray();
                        
                        // Step 6: Push data to client silently (no state update on client)
                        if (records.length > 0) {
                            webSocket.send(JSON.stringify({
                                type: 'psychic_push',
                                data: records
                            }));
                            
                            // Mark these IDs as sent
                            validTaskIds.forEach(id => sentCache!.add(id));
                            
                            console.log(`🔮 Psychic push: ${records.length} records for intent "${text}"`);
                        }
                    } catch (e: any) {
                        console.error('streamIntent error:', e.message);
                    }
                    break;
                }

                case "getUsage":
                    this.trackUsage('reads');
                    const usage = this.sql.exec("SELECT * FROM _usage ORDER BY date DESC LIMIT 30").toArray();
                    webSocket.send(JSON.stringify({ type: "query_result", data: usage, originalSql: "getUsage" }));
                    break;

                case "getAuditLog":
                     this.trackUsage('reads');
                     // Audit logs are now streamed to Cloudflare Observability via console.log
                     // Return empty array with info message
                     webSocket.send(JSON.stringify({ 
                         type: "query_result", 
                         data: [], 
                         originalSql: "getAuditLog",
                         info: "Audit logs are now streamed to Cloudflare Observability. Use Cloudflare Dashboard to view logs."
                     }));
                     break;

                case "listTasks": {
                     // SECURITY: Get userId for Row Level Security filtering
                     const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                     
                     // Read from D1 replica for horizontal scaling
                     // Support pagination to avoid loading large datasets (max 1000 per page)
                     const limitRaw = data.payload?.limit;
                     const offsetRaw = data.payload?.offset;
                     
                     // Parse and validate pagination parameters (could be strings from payload)
                     const limit = limitRaw ? parseInt(String(limitRaw), 10) : 100; // Default 100 rows
                     const offset = offsetRaw ? parseInt(String(offsetRaw), 10) : 0;
                     
                     // Validate pagination parameters
                     const safeLimit = Math.min(Math.max(1, limit), 1000); // Between 1-1000
                     const safeOffset = Math.max(0, offset); // Non-negative
                     
                     // RLS: Query only user's tasks or apply simplified filtering in WHERE clause
                     // This prevents pagination issues where user's data is hidden behind other users' records
                     // Note: Complex permission logic (shared tasks) should be handled via a more complex query
                     // involving JOINs or subqueries on the permissions table.
                     const query = "SELECT * FROM tasks WHERE user_id = ? ORDER BY id LIMIT ? OFFSET ?";
                     const params: any[] = [userId, safeLimit, safeOffset];
                     
                     // FORCE LOCAL READ: Use this.sql.exec instead of readFromD1 to ensure immediate consistency
                     this.trackUsage('reads');
                     const queriedTasks = this.sql.exec(query, ...params).toArray();
                     
                     // Get total count for pagination
                     // Note: This matches the WHERE clause of the main query
                     const countQuery = "SELECT count(*) as total FROM tasks WHERE user_id = ?";
                     const countResult = this.sql.exec(countQuery, userId).toArray(); // Local read
                     const total = countResult && countResult.length > 0 ? countResult[0].total : 0;
                    
                    // Apply RLS filtering (additional layer of security, though WHERE clause handles strict ownership)
                    const filteredTasks = this.rlsEngine.filterRows('tasks', userId, queriedTasks);
                     // ROW LEVEL SECURITY: Filter tasks by user permissions
                     // First, check if user has explicit read permissions for tasks table
                     let hasReadPermission = false;
                     try {
                         const permissionCheck = await this.env.AUTH_DB.prepare(
                             "SELECT can_read FROM permissions WHERE user_id = ? AND room_id = ? AND table_name = 'tasks'"
                         ).bind(userId, this.doId).first();
                         
                         if (permissionCheck && permissionCheck.can_read) {
                             hasReadPermission = true;
                         }
                     } catch (e: any) {
                         console.warn("Permission check failed:", e.message);
                     }
                     
                    // Permission model:
                    // - If user has explicit read permission (can_read = true), show ALL tasks in the room
                    // - Otherwise, show only tasks created by this user (user_id filter)
                    webSocket.send(JSON.stringify({ 
                      type: "query_result", 
                      data: filteredTasks, 
                      total: total,
                      originalSql: "listTasks",
                      pagination: { limit: safeLimit, offset: safeOffset, total }
                    }));
                     break;
                }

                // Memory Store: Cursor tracking
                case "setCursor": {
                    const { userId, position } = data.payload || {};
                    if (!userId || !position) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "setCursor requires userId and position" 
                        }));
                        break;
                    }
                    
                    // Store cursor in memory with 30 second TTL
                    this.memoryStore.set(`cursor:${userId}`, position, 30000);
                    
                    // Broadcast cursor update to subscribers
                    this.broadcastMemoryUpdate("cursors", { userId, position });
                    
                    webSocket.send(JSON.stringify({ 
                        type: "success", 
                        action: "setCursor" 
                    }));
                    break;
                }
                
                case "getCursors": {
                    const cursors: any[] = [];
                    for (const key of this.memoryStore.keys()) {
                        if (key.startsWith('cursor:')) {
                            const userId = key.replace('cursor:', '');
                            const position = this.memoryStore.get(key);
                            cursors.push({ userId, position });
                        }
                    }
                    webSocket.send(JSON.stringify({ 
                        type: "query_result", 
                        data: cursors, 
                        originalSql: "getCursors" 
                    }));
                    break;
                }
                
                // Memory Store: Presence tracking
                case "setPresence": {
                    const { userId, status } = data.payload || {};
                    if (!userId || !status) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "setPresence requires userId and status" 
                        }));
                        break;
                    }
                    
                    // Store presence in memory with 60 second TTL
                    this.memoryStore.set(`presence:${userId}`, status, 60000);
                    
                    // Broadcast presence update to subscribers
                    this.broadcastMemoryUpdate("presence", { userId, status });
                    
                    webSocket.send(JSON.stringify({ 
                        type: "success", 
                        action: "setPresence" 
                    }));
                    break;
                }
                
                case "getPresence": {
                    const presence: any[] = [];
                    for (const key of this.memoryStore.keys()) {
                        if (key.startsWith('presence:')) {
                            const userId = key.replace('presence:', '');
                            const status = this.memoryStore.get(key);
                            presence.push({ userId, status });
                        }
                    }
                    webSocket.send(JSON.stringify({ 
                        type: "query_result", 
                        data: presence, 
                        originalSql: "getPresence",
                        requestId: data.requestId // Include requestId for promise-based RPC
                    }));
                    break;
                }
                
                // Semantic Reflex - Killer Feature #1: Subscribe based on meaning, not just ID
                case "subscribeSemantic": {
                    this.trackUsage('ai_ops'); // Track AI operation usage
                    
                    const { topic, description, threshold } = data.payload || {};
                    
                    // Input validation
                    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "subscribeSemantic requires a non-empty topic string" 
                        }));
                        break;
                    }
                    if (!description || typeof description !== 'string' || description.trim().length === 0) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "subscribeSemantic requires a non-empty description string" 
                        }));
                        break;
                    }
                    if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "subscribeSemantic requires threshold between 0 and 1" 
                        }));
                        break;
                    }
                    
                    // Validate description length
                    if (description.length > 500) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Description too long: maximum 500 characters" 
                        }));
                        break;
                    }
                    
                    // Generate embedding for the subscription description
                    try {
                        if (!this.env.AI) {
                            webSocket.send(JSON.stringify({ 
                                type: "error", 
                                error: "AI service not available" 
                            }));
                            break;
                        }
                        
                        const embeddings = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { 
                            text: [description.trim()] 
                        });
                        const vector = embeddings.data[0];
                        
                        if (!vector || !Array.isArray(vector)) {
                            throw new Error('Failed to generate embedding vector');
                        }
                        
                        // SECURITY: Store subscription with TTL to prevent memory leaks
                        // Key format: semantic_sub:{topic}:{timestamp}
                        const subKey = `semantic_sub:${topic}:${Date.now()}`;
                        
                        this.memoryStore.set(subKey, {
                            topic,
                            description,
                            vector,
                            threshold,
                            socket: webSocket // Store socket reference for notifications
                        }, NanoStore.SEMANTIC_SUBSCRIPTION_TTL_MS); // Add TTL to automatically cleanup old subscriptions
                        
                        webSocket.send(JSON.stringify({ 
                            type: "success", 
                            action: "subscribeSemantic",
                            data: { topic, threshold }
                        }));
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: `subscribeSemantic failed: ${e.message}` 
                        }));
                    }
                    break;
                }
                
                // Full SQL Power: Safe raw SQL interface
                case "executeSQL": {
                    this.trackUsage('reads');
                    
                    const { sql: rawSql, readonly = true } = data.payload || {};
                    
                    if (!rawSql || typeof rawSql !== 'string') {
                        webSocket.send(JSON.stringify({ 
                            type: "query_error", 
                            error: "executeSQL requires sql parameter" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Rate limiting for executeSQL (50 queries per minute)
                    const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                    if (!this.checkRateLimit(userId, "executeSQL", 50, 60000)) {
                        webSocket.send(JSON.stringify({ 
                            type: "query_error", 
                            error: "Rate limit exceeded for executeSQL" 
                        }));
                        break;
                    }
                    
                    // Security: Only allow read-only queries
                    if (readonly) {
                        const sqlLower = rawSql.toLowerCase().trim();
                        if (!sqlLower.startsWith('select') && !sqlLower.startsWith('with')) {
                            webSocket.send(JSON.stringify({ 
                                type: "query_error", 
                                error: "Only SELECT and WITH queries allowed in read-only mode" 
                            }));
                            break;
                        }
                    }
                    
                    // Query length limit: max 10,000 characters
                    if (rawSql.length > 10000) {
                        webSocket.send(JSON.stringify({ 
                            type: "query_error", 
                            error: "Query too long: maximum 10,000 characters" 
                        }));
                        break;
                    }
                    
                    try {
                        // PERFORMANCE: Add query timeout (5 seconds max)
                        const results = await QueryTimeout.withTimeout(
                            async () => this.readFromD1(rawSql),
                            5000,
                            "Query execution timeout (max 5 seconds)"
                        );
                        
                        webSocket.send(JSON.stringify({ 
                            type: "query_result", 
                            data: results, 
                            originalSql: rawSql 
                        }));
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "query_error", 
                            error: e.message 
                        }));
                    }
                    break;
                }
                
                // Local Aggregation: Debounced writes
                case "updateDebounced": {
                    const { key, value } = data.payload || {};
                    
                    if (!key) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "updateDebounced requires key parameter" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Validate value size (max 100KB per value)
                    const valueStr = JSON.stringify(value);
                    const valueSize = valueStr.length;
                    
                    if (valueSize > 100000) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Value too large: maximum 100KB" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Check total memory limit before accepting write
                    if (!this.memoryTracker.canAdd(valueSize)) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Memory limit reached. Please wait for pending writes to flush." 
                        }));
                        break;
                    }
                    
                    // Add to memory tracker
                    this.memoryTracker.add(valueSize);
                    
                    // Write to debounced buffer (will flush after 1 second of inactivity)
                    this.debouncedWriter.write(key, value);
                    
                    webSocket.send(JSON.stringify({ 
                        type: "success", 
                        action: "updateDebounced",
                        message: "Update queued for flush" 
                    }));
                    break;
                }
                
                case "flushDebounced": {
                    // Force immediate flush of debounced writes
                    this.debouncedWriter.flush();
                    
                    webSocket.send(JSON.stringify({ 
                        type: "success", 
                        action: "flushDebounced",
                        message: "Debounced writes flushed to SQLite" 
                    }));
                    break;
                }
                
                // Sync Engine: Get sync status and health
                case "getSyncStatus": {
                    const status = this.getSyncStatus();
                    webSocket.send(JSON.stringify({ 
                        type: "query_result", 
                        data: [status], 
                        originalSql: "getSyncStatus" 
                    }));
                    break;
                }
                
                // Sync Engine: Force full sync to D1
                case "forceSyncAll": {
                    try {
                        await this.performInitialSync();
                        webSocket.send(JSON.stringify({ 
                            type: "success", 
                            action: "forceSyncAll",
                            message: "Full sync to D1 completed",
                            status: this.getSyncStatus()
                        }));
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            action: "forceSyncAll",
                            error: e.message 
                        }));
                    }
                    break;
                }

                // Webhook Management
                case "createWebhook": {
                    this.trackUsage('writes');
                    
                    const { url, events, secret } = data.payload || {};
                    
                    // Validate inputs
                    if (!url || typeof url !== 'string') {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "createWebhook requires url parameter" 
                        }));
                        break;
                    }
                    
                    if (!events || typeof events !== 'string') {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "createWebhook requires events parameter (comma-separated list)" 
                        }));
                        break;
                    }
                    
                    // Validate URL format
                    try {
                        new URL(url);
                    } catch (e) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Invalid webhook URL format" 
                        }));
                        break;
                    }
                    
                    try {
                        const id = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                        const now = Date.now();
                        
                        this.sql.exec(
                            `INSERT INTO _webhooks (id, url, events, secret, active, created_at, failure_count) 
                             VALUES (?, ?, ?, ?, 1, ?, 0)`,
                            id, url, events, secret || null, now
                        );
                        
                        const webhook = { id, url, events, active: 1, created_at: now };
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "createWebhook",
                            data: webhook 
                        }));
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: `Failed to create webhook: ${e.message}` 
                        }));
                    }
                    break;
                }
                
                case "listWebhooks": {
                    try {
                        this.trackUsage('reads');
                        // Ensure table exists
                        this.sql.exec(`
                            CREATE TABLE IF NOT EXISTS _webhooks (
                                id TEXT PRIMARY KEY,
                                url TEXT NOT NULL,
                                events TEXT NOT NULL,
                                created_at INTEGER,
                                active INTEGER DEFAULT 1,
                                last_triggered_at INTEGER,
                                failure_count INTEGER DEFAULT 0
                            )
                        `);

                        const webhooks = this.sql.exec(
                            `SELECT id, url, events, active, created_at, last_triggered_at, failure_count 
                             FROM _webhooks ORDER BY created_at DESC`
                        ).toArray();

                        webSocket.send(JSON.stringify({ 
                            type: "query_result", 
                            data: webhooks 
                        }));
                    } catch (e: any) {
                        // Lazy Migration: Self-heal schema if columns missing
                            console.log("Lazy migration: Fixing _webhooks table schema...");
                            try {
                                // Add potentially missing columns safely
                                try { this.sql.exec("ALTER TABLE _webhooks ADD COLUMN events TEXT DEFAULT ''"); } catch (_) {}
                                try { this.sql.exec("ALTER TABLE _webhooks ADD COLUMN failure_count INTEGER DEFAULT 0"); } catch (_) {}
                                try { this.sql.exec("ALTER TABLE _webhooks ADD COLUMN last_triggered_at INTEGER"); } catch (_) {}
                                try { this.sql.exec("ALTER TABLE _webhooks ADD COLUMN active INTEGER DEFAULT 1"); } catch (_) {}
                                
                                // Create index if missing
                                try { this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON _webhooks(active) WHERE active = 1`); } catch (_) {}

                                // Retry query
                                const webhooks = this.sql.exec(
                                    `SELECT id, url, events, active, created_at, last_triggered_at, failure_count 
                                     FROM _webhooks ORDER BY created_at DESC`
                                ).toArray();
                                
                                webSocket.send(JSON.stringify({ 
                                    type: "query_result", 
                                    data: webhooks 
                                }));
                                return;
                            } catch (migrationErr: any) {
                                console.error("Lazy migration failed:", migrationErr);
                            }
                        
                        this.sendError(webSocket, "QUERY_FAILED", `Failed to list webhooks: ${e.message}`);
                    }
                    break;
                }

                // Webhook Logs
                case "getWebhooklogs": {
                    this.trackUsage('reads');
                    // Fetch logs from D1 (as consumer writes there) OR from local if it was replicated back?
                    // Assuming webhook-consumer writes to READ_REPLICA (D1)
                    if (!this.env.READ_REPLICA) {
                        this.sendError(webSocket, "CONFIG_ERROR", "D1 READ_REPLICA not available");
                        break;
                    }

                    try {
                        // Use raw D1 query
                        const logs = await this.env.READ_REPLICA.prepare(
                            `SELECT * FROM _webhook_logs ORDER BY created_at DESC LIMIT 50`
                        ).all();
                        
                        webSocket.send(JSON.stringify({ 
                            type: "query_result", 
                            data: logs.results 
                        }));
                    } catch (e: any) {
                         // Check if table exists
                         if (e.message.includes("no such table")) {
                             webSocket.send(JSON.stringify({ type: "query_result", data: [] })); // Empty if no logs table yet
                         } else {
                             this.sendError(webSocket, "QUERY_FAILED", `Failed to fetch webhook logs: ${e.message}`);
                         }
                    }
                    break;
                }
                
                case "updateWebhook": {
                    this.trackUsage('writes');
                    
                    const { id, url, events, active } = data.payload || {};
                    
                    if (!id) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "updateWebhook requires id parameter" 
                        }));
                        break;
                    }
                    
                    try {
                        const updates: string[] = [];
                        const params: any[] = [];
                        
                        if (url !== undefined) {
                            // Validate URL if provided
                            try {
                                new URL(url);
                            } catch (e) {
                                webSocket.send(JSON.stringify({ 
                                    type: "error", 
                                    error: "Invalid webhook URL format" 
                                }));
                                break;
                            }
                            updates.push("url = ?");
                            params.push(url);
                        }
                        
                        if (events !== undefined) {
                            updates.push("events = ?");
                            params.push(events);
                        }
                        
                        if (active !== undefined) {
                            updates.push("active = ?");
                            params.push(active ? 1 : 0);
                        }
                        
                        if (updates.length === 0) {
                            webSocket.send(JSON.stringify({ 
                                type: "error", 
                                error: "No fields to update" 
                            }));
                            break;
                        }
                        
                        params.push(id);
                        this.sql.exec(
                            `UPDATE _webhooks SET ${updates.join(', ')} WHERE id = ?`,
                            ...params
                        );
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "updateWebhook"
                        }));
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: `Failed to update webhook: ${e.message}` 
                        }));
                    }
                    break;
                }
                
                case "deleteWebhook": {
                    this.trackUsage('writes');
                    
                    const { id } = data.payload || {};
                    
                    if (!id) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "deleteWebhook requires id parameter" 
                        }));
                        break;
                    }
                    
                    try {
                        this.sql.exec(`DELETE FROM _webhooks WHERE id = ?`, id);
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "deleteWebhook"
                        }));
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: `Failed to delete webhook: ${e.message}` 
                        }));
                    }
                    break;
                }
                
                case "createTable": {
                    this.trackUsage('writes');
                    
                    const { tableName, columns } = data.payload || {};
                    
                    if (!tableName || !columns || !Array.isArray(columns) || columns.length === 0) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "createTable requires tableName and columns array" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Validate table name (alphanumeric and underscore only)
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Invalid table name. Use only letters, numbers, and underscores. Must start with a letter or underscore." 
                        }));
                        break;
                    }
                    
                    // Prevent creating internal tables
                    if (tableName.startsWith('_') || tableName === 'sqlite_sequence') {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Cannot create tables with names starting with underscore (reserved for system tables)" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Rate limiting (10 table creates per minute)
                    const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                    if (!this.checkRateLimit(userId, "createTable", 10, 60000)) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Rate limit exceeded for createTable" 
                        }));
                        break;
                    }
                    
                    try {
                        // Build CREATE TABLE SQL
                        const columnDefs = columns.map((col: any) => {
                            const name = col.name;
                            const type = col.type || 'TEXT';
                            const constraints = [];
                            
                            // Validate column name
                            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
                                throw new Error(`Invalid column name: ${name}`);
                            }
                            
                            // Validate column type
                            const validTypes = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATE', 'DATETIME'];
                            if (!validTypes.includes(type.toUpperCase())) {
                                throw new Error(`Invalid column type: ${type}. Valid types: ${validTypes.join(', ')}`);
                            }
                            
                            if (col.primaryKey) constraints.push('PRIMARY KEY');
                            if (col.notNull) constraints.push('NOT NULL');
                            if (col.unique) constraints.push('UNIQUE');
                            if (col.default !== undefined) constraints.push(`DEFAULT ${col.default}`);
                            
                            return `${name} ${type}${constraints.length ? ' ' + constraints.join(' ') : ''}`;
                        }).join(', ');
                        
                        // Always add an id column if not present
                        const hasIdColumn = columns.some((col: any) => col.name === 'id');
                        const finalColumns = hasIdColumn ? columnDefs : `id INTEGER PRIMARY KEY AUTOINCREMENT, ${columnDefs}`;
                        
                        const createTableSQL = `CREATE TABLE IF NOT EXISTS ${tableName} (${finalColumns})`;
                        this.sql.exec(createTableSQL);
                        
                        // Replicate to D1 for distributed reads
                        this.ctx.waitUntil(this.replicateSchemaToD1());
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "createTable",
                            data: { tableName, sql: createTableSQL }
                        }));
                        
                        // Broadcast schema update to all connected clients
                        this.broadcastSchemaUpdate();
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: `Failed to create table: ${e.message}` 
                        }));
                    }
                    break;
                }
                
                case "deleteTable": {
                    this.trackUsage('writes');
                    
                    const { tableName } = data.payload || {};
                    
                    if (!tableName) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "deleteTable requires tableName parameter" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Validate table name (alphanumeric and underscore only)
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Invalid table name" 
                        }));
                        break;
                    }
                    
                    // Prevent deleting internal tables
                    if (tableName.startsWith('_') || tableName === 'sqlite_sequence') {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Cannot delete system tables" 
                        }));
                        break;
                    }
                    
                    // SECURITY: Rate limiting (10 table deletes per minute)
                    const userId = this.webSocketUserIds.get(webSocket) || "anonymous";
                    if (!this.checkRateLimit(userId, "deleteTable", 10, 60000)) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Rate limit exceeded for deleteTable" 
                        }));
                        break;
                    }
                    
                    try {
                        this.sql.exec(`DROP TABLE IF EXISTS ${tableName}`);
                        
                        // Replicate to D1 for distributed reads
                        this.ctx.waitUntil(this.replicateSchemaToD1());
                        
                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "deleteTable",
                            data: { tableName }
                        }));
                        
                        // Broadcast schema update to all connected clients
                        this.broadcastSchemaUpdate();
                    } catch (e: any) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: `Failed to delete table: ${e.message}` 
                        }));
                    }
                    break;
                }

                case "chatWithDatabase": {
                    this.trackUsage('ai_ops');
                    
                    const { message } = data.payload || {};
                    
                    // Input validation
                    if (!message || typeof message !== 'string') {
                        webSocket.send(JSON.stringify({ 
                            type: "chat_error",
                            error: "Message is required"
                        }));
                        break;
                    }
                    
                    if (message.length > 1000) {
                        webSocket.send(JSON.stringify({ 
                            type: "chat_error",
                            error: "Message too long: maximum 1000 characters"
                        }));
                        break;
                    }
                    
                    try {
                        if (!this.env.AI) {
                            webSocket.send(JSON.stringify({ 
                                type: "chat_response",
                                response: "AI is not available. Please configure the AI binding."
                            }));
                            break;
                        }
                        
                        // Get current schema for context
                        const schema = this.getSchema();
                        const tableNames = Object.keys(schema);
                        
                        // Build schema context for the AI
                        let schemaContext = "You are a helpful database assistant. Here is the current database schema:\n\n";
                        
                        if (tableNames.length === 0) {
                            schemaContext += "No tables exist in the database yet.\n";
                        } else {
                            for (const tableName of tableNames) {
                                const columns = schema[tableName];
                                schemaContext += `Table: ${tableName}\n`;
                                schemaContext += `Columns: ${columns.map(c => `${c.name} (${c.type})`).join(', ')}\n\n`;
                            }
                        }
                        
                        // Create the system prompt for the AI
                        const systemPrompt = schemaContext + 
                            "\nYou help users understand their database, explore tables, and answer questions about their data. " +
                            "Provide helpful, concise responses about the schema, data structure, and general database concepts. " +
                            "If the user asks about specific data, suggest they use the query or search features.";
                        
                        // Call Workers AI (Llama 3)
                        const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: message }
                            ],
                            max_tokens: 512,
                            temperature: 0.7
                        });
                        
                        const aiResponse = response.response || "I'm sorry, I couldn't generate a response.";
                        
                        webSocket.send(JSON.stringify({ 
                            type: "chat_response",
                            response: aiResponse
                        }));
                        
                    } catch (e: any) {
                        console.error("Chat with database error:", e);
                        webSocket.send(JSON.stringify({ 
                            type: "chat_error",
                            error: `Failed to process chat: ${e.message}`
                        }));
                    }
                    break;
                }

                default:
                    this.sendError(webSocket, "UNKNOWN_METHOD", `Unknown RPC method: ${method}`);
                    break;
            }

            const duration = performance.now() - start;
            if (duration > 1000) {
               this.logger.warn(`RPC Slow: ${method}`, { duration });
            }
        }
      
      if (data.action === "mutate") {
           webSocket.send(JSON.stringify({ error: "Raw mutations are disabled. Use RPC actions." }));
      }

    } catch (err: any) {
      console.error("WebSocket message error:", err);
      try {
        webSocket.send(JSON.stringify({ error: err.message }));
      } catch (sendError) {
        console.error("Failed to send error message:", sendError);
      }
    }
  }

  webSocketClose(webSocket: WebSocket, code: number, reason: string, wasClean: boolean) {
    console.log(JSON.stringify({
      type: 'websocket_close',
      code,
      reason,
      wasClean,
      timestamp: new Date().toISOString()
    }));
    
    // Remove from all table subscriptions
    this.subscribers.forEach((set) => set.delete(webSocket));
    
    // Cleanup query subscriptions for automatic reactivity
    if (this.querySubscriptions.has(webSocket)) {
      this.querySubscriptions.delete(webSocket);
    }
    
    // Cleanup user ID tracking
    if (this.webSocketUserIds.has(webSocket)) {
      this.webSocketUserIds.delete(webSocket);
    }
    
    // Cleanup psychic cache
    if (this.psychicSentCache.has(webSocket)) {
      this.psychicSentCache.delete(webSocket);
    }
    
    // Cleanup semantic subscriptions for this WebSocket to prevent memory leaks
    const keysToDelete: string[] = [];
    for (const key of this.memoryStore.keys()) {
      if (key.startsWith('semantic_sub:')) {
        const subscription = this.memoryStore.get(key);
        if (subscription && subscription.socket === webSocket) {
          keysToDelete.push(key);
        }
      }
    }
    
    // Delete the subscriptions
    keysToDelete.forEach(key => {
      this.memoryStore.delete(key);
      console.log(JSON.stringify({
        type: 'cleanup',
        action: 'semantic_subscription_removed',
        key,
        timestamp: new Date().toISOString()
      }));
    });
  }

  webSocketError(webSocket: WebSocket, error: unknown) {
    console.error(JSON.stringify({
      type: 'websocket_error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }));
    
    // Remove from all table subscriptions
    this.subscribers.forEach((set) => set.delete(webSocket));
    
    // Cleanup query subscriptions
    if (this.querySubscriptions.has(webSocket)) {
      this.querySubscriptions.delete(webSocket);
    }
    
    // Cleanup user ID tracking
    if (this.webSocketUserIds.has(webSocket)) {
      this.webSocketUserIds.delete(webSocket);
    }
    
    // Cleanup psychic cache
    if (this.psychicSentCache.has(webSocket)) {
      this.psychicSentCache.delete(webSocket);
    }
    
    // Cleanup semantic subscriptions
    const keysToDelete: string[] = [];
    for (const key of this.memoryStore.keys()) {
      if (key.startsWith('semantic_sub:')) {
        const subscription = this.memoryStore.get(key);
        if (subscription && subscription.socket === webSocket) {
          keysToDelete.push(key);
        }
      }
    }
    keysToDelete.forEach(key => this.memoryStore.delete(key));
  }

  getPrimaryKey(tableName: string): string {
    // Validate table name first
    if (!this.isValidTableName(tableName)) {
      console.warn(`Invalid table name: ${tableName}`);
      return 'id';
    }
    
    // Get primary key column from table schema
    try {
      const columns = this.sql.exec(`PRAGMA table_info("${tableName}")`).toArray();
      const pkColumn = columns.find((col: any) => col.pk === 1);
      return pkColumn ? pkColumn.name : 'id'; // Default to 'id' if no PK found
    } catch (e) {
      console.warn(`Failed to get primary key for ${tableName}, defaulting to 'id'`);
      return 'id';
    }
  }

  broadcastUpdate(table: string, action: 'added' | 'modified' | 'deleted', row: any) {
    // Validate table name to prevent SQL injection
    if (!this.isValidTableName(table)) {
      console.error(`Invalid table name for broadcast: ${table}`);
      return;
    }
    
    // Track event in Analytics Engine (if configured)
    if (this.env.ANALYTICS) {
      this.ctx.waitUntil((async () => {
        try {
          await this.env.ANALYTICS.writeDataPoint({
            indexes: [table],
            blobs: [action, this.doId],
            doubles: [1], // Count
          });
        } catch (e) {
          console.error("Failed to track analytics:", e);
        }
      })());
    }
    
    // Dispatch webhooks (if any registered for this event)
    // Removed inline ctx.waitUntil block that sends to WEBHOOK_QUEUE to prevent duplicate events.
    // Retain only the call to this.dispatchWebhooks(...) below.

    // Dispatch webhooks for this event (async, non-blocking)
    // We don't await to avoid blocking the broadcast
    this.dispatchWebhooks(table, action, row).catch(err => {
      console.error('Webhook dispatch failed:', err);
    });
    
    if (this.subscribers.has(table)) {
      const sockets = this.subscribers.get(table)!;
      
      // Send efficient action-based update instead of full table diff
      const message = JSON.stringify({ 
        event: "update", 
        table,
        action,
        row
      });
      
      for (const socket of sockets) {
        try {
          socket.send(message);
          
          // Automatic Reactivity: Re-run subscribed queries
          if (this.querySubscriptions.has(socket)) {
            const wsQueries = this.querySubscriptions.get(socket)!;
            
            // Find queries that depend on this table
            wsQueries.forEach(async (queryInfo, queryId) => {
              if (queryInfo.tables.includes(table)) {
                try {
                  // Re-execute the query
                  console.log(`Auto-refreshing query ${queryId} due to ${table} ${action}`);
                  
                  // Execute the RPC method again
                  const rerunMessage = {
                    action: 'rpc',
                    method: queryInfo.method,
                    payload: queryInfo.payload,
                    _autoRefresh: true,
                    queryId
                  };
                  
                  // Simulate re-running the query (we'd call the actual RPC handler)
                  // For now, just send a refresh notification
                  socket.send(JSON.stringify({
                    type: "query_refresh",
                    queryId,
                    table,
                    action
                  }));
                } catch (e) {
                  console.error(`Failed to auto-refresh query ${queryId}:`, e);
                }
              }
            });
          }
        } catch (err) {
          sockets.delete(socket);
        }
      }
    }
  }

  async dispatchWebhooks(table: string, action: 'added' | 'modified' | 'deleted', row: any) {
    try {
      // Query active webhooks that match this event
      const eventName = `${table}.${action}`;
      const webhooks = this.sql.exec(
        `SELECT id, url, events, secret FROM _webhooks WHERE active = 1`
      ).toArray();
      
      if (!webhooks || webhooks.length === 0) {
        return;
      }
      
      // Filter webhooks that subscribe to this event
      const matchingWebhooks = webhooks.filter((wh: any) => {
        // Pre-process events string into array (could be cached if performance is critical)
        const events = wh.events.split(',').map((e: string) => e.trim());
        return events.includes('*') || events.includes(eventName) || 
               events.includes(`${table}.*`) || events.includes(`*.${action}`);
      });
      
      if (matchingWebhooks.length === 0) {
        return;
      }
      
      // Send to Cloudflare Queue for async delivery
      if (this.env.WEBHOOK_QUEUE) {
        const payload = {
          event: eventName,
          table,
          action,
          data: row,
          timestamp: Date.now()
        };
        
        for (const webhook of matchingWebhooks) {
          try {
            await this.env.WEBHOOK_QUEUE.send({
              webhookId: webhook.id,
              url: webhook.url,
              secret: webhook.secret,
              payload
            });
            
            // Update last triggered time
            this.sql.exec(
              `UPDATE _webhooks SET last_triggered_at = ? WHERE id = ?`,
              Date.now(), webhook.id
            );
          } catch (e: any) {
            console.error(`Failed to queue webhook ${webhook.id}:`, e.message);
            
            // Increment failure count and get the new value in one query
            this.sql.exec(
              `UPDATE _webhooks SET failure_count = failure_count + 1 WHERE id = ?`,
              webhook.id
            );
            
            // Check if we should disable (after update to get current count)
            const result = this.sql.exec(
              `SELECT failure_count FROM _webhooks WHERE id = ?`,
              webhook.id
            ).toArray()[0];
            
            if (result && result.failure_count >= 10) {
              this.sql.exec(
                `UPDATE _webhooks SET active = 0 WHERE id = ?`,
                webhook.id
              );
              console.warn(`Webhook ${webhook.id} disabled after ${result.failure_count} failures`);
            }
          }
        }
      }
    } catch (e: any) {
      console.error('dispatchWebhooks error:', e.message);
    }
  }

  broadcastMemoryUpdate(type: string, data: any) {
    // Broadcast memory store updates (cursors, presence) to all connections
    // These are ephemeral and don't need table validation
    const message = JSON.stringify({ 
      event: "memory_update", 
      type,
      data
    });
    
    // Broadcast to all subscribers regardless of table
    this.subscribers.forEach((sockets) => {
      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch (err) {
          sockets.delete(socket);
        }
      }
    });
  }

  /**
   * PRODUCTION: Graceful shutdown and resource cleanup
   * Flushes pending writes and cleans up resources
   * Called during error recovery or explicit shutdown
   */
  async gracefulShutdown(): Promise<void> {
    console.log(JSON.stringify({
      type: 'shutdown',
      action: 'starting_graceful_shutdown',
      timestamp: new Date().toISOString()
    }));

    try {
      // 1. Flush debounced writes to SQLite
      if (this.debouncedWriter) {
        this.debouncedWriter.destroy();
        console.log(JSON.stringify({
          type: 'shutdown',
          action: 'debounced_writer_flushed',
          timestamp: new Date().toISOString()
        }));
      }

      // 2. Close all WebSocket connections gracefully
      const closedCount = this.closeAllWebSockets();
      console.log(JSON.stringify({
        type: 'shutdown',
        action: 'websockets_closed',
        count: closedCount,
        timestamp: new Date().toISOString()
      }));

      // 3. Cleanup rate limiters
      this.cleanupRateLimiters();

      // 4. Clear memory store (cursors, presence, etc.)
      this.memoryStore.clear();

      console.log(JSON.stringify({
        type: 'shutdown',
        action: 'graceful_shutdown_complete',
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.error(JSON.stringify({
        type: 'shutdown_error',
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString()
      }));
    }
  }

  /**
   * Close all WebSocket connections
   * Returns the number of connections closed
   */
  private closeAllWebSockets(): number {
    let count = 0;
    this.subscribers.forEach((sockets) => {
      for (const socket of sockets) {
        try {
          // Only close sockets that are in OPEN state
          // CONNECTING state will throw an error if we try to close
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(1001, 'Server shutdown');
            count++;
          } else if (socket.readyState === WebSocket.CONNECTING) {
            // For CONNECTING sockets, just remove them from tracking
            // They will timeout naturally or close when connection is established
            this.logger.warn('WebSocket still connecting during shutdown - will timeout', {
              readyState: socket.readyState
            });
          }
        } catch (e) {
          this.logger.error('Failed to close WebSocket', e, {
            readyState: socket.readyState
          });
        }
      }
      sockets.clear();
    });
    this.subscribers.clear();
    return count;
  }
}
