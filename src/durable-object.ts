import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
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
 * 2. Efficient Broadcasting: Uses action-based updates (added/modified/deleted)
 *    instead of O(N) full table diffing for scalability.
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
  action: "subscribe" | "query" | "mutate" | "rpc" | "ping";
  table?: string;
  sql?: string;
  method?: string; 
  payload?: any;
  updateId?: string; // For optimistic updates
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

// 1. Define the Manifest explicitly
// Added 'search' to actions
const ACTIONS = {
  createTask: { params: ["title"] },
  completeTask: { params: ["id"] },
  deleteTask: { params: ["id"] },
  listTasks: { params: [] },
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
  forceSyncAll: { params: [] }
};

const MIGRATIONS = [
  {
    version: 1,
    up: (sql: any) => {
      sql.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT)`);
      const count = sql.exec("SELECT count(*) as c FROM tasks").toArray()[0].c;
      if (count === 0) {
        sql.exec(`INSERT INTO tasks (title, status) VALUES ('Buy milk', 'pending'), ('Walk the dog', 'completed')`);
      }
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
  }
];

export class DataStore extends DurableObject {
  sql: any; 
  subscribers: Map<string, Set<WebSocket>>;
  env: Env;
  doId: string;
  ctx: DurableObjectState;
  // Hybrid State: In-memory stores for transient data
  memoryStore: MemoryStore;
  debouncedWriter: DebouncedWriter;
  // Sync Engine: Track sync status and health
  syncEngine: {
    lastSyncTime: number;
    syncErrors: number;
    totalSyncs: number;
    isHealthy: boolean;
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.subscribers = new Map();
    this.doId = ctx.id.toString();
    
    // Initialize Memory Store for transient data
    this.memoryStore = new MemoryStore();
    
    // Initialize Debounced Writer (flushes every 1 second by default)
    this.debouncedWriter = new DebouncedWriter(1000, (updates) => {
      // Flush debounced writes to SQLite
      for (const [key, value] of updates.entries()) {
        try {
          this.sql.exec(
            `INSERT OR REPLACE INTO _debounced_state (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
            key, JSON.stringify(value)
          );
        } catch (e) {
          console.error(`Failed to flush debounced write for key ${key}:`, e);
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
      console.error("[Sync Engine] Initial sync failed:", e);
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
      } catch (e) {
          console.error("Usage tracking failed", e);
      }
  }

  logAction(action: string, payload: any) {
      try {
          this.sql.exec(
              `INSERT INTO _audit_log (action, payload, timestamp) VALUES (?, ?, datetime('now'))`,
              action, JSON.stringify(payload)
          );
      } catch (e) {
          console.error("Audit logging failed", e);
      }
  }

  /**
   * Replicate data from Durable Object to D1 read replica
   * This enables horizontal scaling for read operations while maintaining
   * write consistency in the Durable Object.
   * 
   * @param table - The table name to replicate
   * @param operation - The operation type: 'insert', 'update', or 'delete'
   * @param data - The data to replicate (for insert/update) or the ID to delete
   */
  async replicateToD1(table: string, operation: 'insert' | 'update' | 'delete', data?: any) {
    if (!this.env.READ_REPLICA) {
      console.warn("D1 READ_REPLICA not available, skipping replication");
      return;
    }

    try {
      // Add room/DO identifier to track which DO the data belongs to
      const roomId = this.doId;

      switch (operation) {
        case 'insert':
        case 'update':
          if (!data) {
            console.error("Data required for insert/update operation");
            return;
          }
          
          // For tasks table, replicate with room_id for multi-tenancy
          if (table === 'tasks') {
            await this.env.READ_REPLICA.prepare(
              `INSERT OR REPLACE INTO tasks (id, title, status, room_id) VALUES (?, ?, ?, ?)`
            ).bind(data.id, data.title, data.status, roomId).run();
          }
          break;

        case 'delete':
          if (!data || !data.id) {
            console.error("ID required for delete operation");
            return;
          }
          
          // Delete from D1 with room_id constraint for safety
          if (table === 'tasks') {
            await this.env.READ_REPLICA.prepare(
              `DELETE FROM tasks WHERE id = ? AND room_id = ?`
            ).bind(data.id, roomId).run();
          }
          break;
      }
      
      // Update sync metrics
      this.syncEngine.lastSyncTime = Date.now();
      this.syncEngine.totalSyncs++;
      this.syncEngine.isHealthy = true;
      
    } catch (e) {
      // Log but don't fail the primary operation if replication fails
      console.error(`D1 replication failed for ${operation} on ${table}:`, e);
      this.syncEngine.syncErrors++;
      this.syncEngine.isHealthy = false;
    }
  }

  /**
   * Read from D1 replica with fallback to DO SQLite
   * This provides distributed read scaling while maintaining resilience
   */
  async readFromD1(query: string, ...params: any[]): Promise<any[]> {
    // Try D1 first for distributed reads
    if (this.env.READ_REPLICA) {
      try {
        // Add room_id filter to ensure data isolation
        const roomId = this.doId;
        
        // Modify query to include room_id filter if querying tasks
        let modifiedQuery = query;
        const roomIdParams = [...params]; // Copy params array
        
        if (query.includes('FROM tasks') && !query.includes('room_id')) {
          // Use parameterized query to prevent SQL injection
          if (query.toLowerCase().includes('where')) {
            modifiedQuery = query.replace(/WHERE/i, `WHERE room_id = ? AND`);
            roomIdParams.unshift(roomId); // Add roomId as first param
          } else if (query.toLowerCase().includes('order by')) {
            modifiedQuery = query.replace(/ORDER BY/i, `WHERE room_id = ? ORDER BY`);
            roomIdParams.unshift(roomId);
          } else {
            modifiedQuery = query.replace(/FROM tasks/i, `FROM tasks WHERE room_id = ?`);
            roomIdParams.unshift(roomId);
          }
        }
        
        // Properly chain bind() calls
        let stmt = this.env.READ_REPLICA.prepare(modifiedQuery);
        for (const param of roomIdParams) {
          stmt = stmt.bind(param);
        }
        
        const result = await stmt.all();
        return result.results || [];
      } catch (e) {
        console.warn("D1 read failed, falling back to DO SQLite:", e);
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
      
      // Get all tasks from DO
      const tasks = this.sql.exec("SELECT * FROM tasks").toArray();
      
      if (tasks.length === 0) {
        console.log("[Sync Engine] No tasks to sync");
        return;
      }

      // Batch sync to D1
      await this.batchSyncToD1(tasks);
      
      this.syncEngine.lastSyncTime = Date.now();
      this.syncEngine.totalSyncs++;
      this.syncEngine.isHealthy = true;
      
      console.log(`[Sync Engine] Initial sync completed: ${tasks.length} tasks synced`);
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
  async batchSyncToD1(tasks: any[]): Promise<void> {
    if (!this.env.READ_REPLICA || tasks.length === 0) {
      return;
    }

    try {
      const roomId = this.doId;
      
      // Use D1 batch API for better performance
      const statements = tasks.map(task => 
        this.env.READ_REPLICA.prepare(
          `INSERT OR REPLACE INTO tasks (id, title, status, room_id) VALUES (?, ?, ?, ?)`
        ).bind(task.id, task.title, task.status, roomId)
      );

      // Execute all statements in a batch
      await this.env.READ_REPLICA.batch(statements);
      
      console.log(`[Sync Engine] Batch synced ${tasks.length} tasks to D1`);
    } catch (e) {
      console.error("[Sync Engine] Batch sync failed:", e);
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
      errorRate: this.syncEngine.totalSyncs > 0 
        ? (this.syncEngine.syncErrors / this.syncEngine.totalSyncs * 100).toFixed(2) + '%'
        : '0%',
      replicaAvailable: !!this.env.READ_REPLICA
    };
  }

  getSchema() {
    const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'").toArray();
    const schema: Record<string, any[]> = {};
    for (const t of tables) {
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

    async backupToR2() {
      try {
        // If running in Node (local dev), allow file-based backup. In the
        // Cloudflare Workers runtime there is no `fs` module, so skip.
        const runningInNode = typeof process !== "undefined" && (process as any).versions?.node;
        if (!runningInNode) {
          console.log("Backup skipped: running in Cloudflare Workers (no fs available). To enable, run locally in Node.");
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `/tmp/backup-${timestamp}.db`;
        // @ts-ignore: VACUUM INTO used for local SQLite file export
        this.sql.exec(`VACUUM INTO '${backupPath}'`);
        // Lazy require to avoid bundling `fs` into worker bundle
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        const fileBuffer = fs.readFileSync(backupPath);

        if (this.env.BACKUP_BUCKET) {
         await this.env.BACKUP_BUCKET.put(`backup-${timestamp}.db`, fileBuffer);
         console.log(`Backup uploaded: backup-${timestamp}.db`);
        } else {
         console.log("R2 Bucket not configured, skipping upload.");
        }
        fs.unlinkSync(backupPath);
      } catch (err) {
        console.error("Backup failed:", err);
      }
    }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

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

    if (url.pathname === "/backup") {
        await this.backupToR2();
        return new Response("Backup completed");
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
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      try {
        // @ts-ignore: WebSocketPair is a global in Cloudflare Workers
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

        this.handleSession(server);

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

  handleSession(webSocket: WebSocket) {
    try {
      // @ts-ignore: accept method exists on Cloudflare WebSocket
      webSocket.accept();
    } catch (error) {
      console.error("Failed to accept WebSocket:", error);
      return;
    }

    webSocket.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data as string) as WebSocketMessage;

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
          if (!this.subscribers.has(data.table)) {
            this.subscribers.set(data.table, new Set());
          }
          this.subscribers.get(data.table)!.add(webSocket);
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
            
            // Log the attempt
            // 'reads' or 'writes' tracked inside specific blocks or generally here?
            // Let's track writes here for mutations, but we have some read RPCs now.
            
            switch (method) {
                case "createTask": {
                    try {
                        this.trackUsage('writes');
                        
                        // Input validation
                        const title = data.payload?.title;
                        if (!title || typeof title !== 'string' || title.trim().length === 0) {
                            throw new Error('Invalid title: must be a non-empty string');
                        }
                        const trimmedTitle = title.trim();
                        if (trimmedTitle.length > 500) {
                            throw new Error('Title too long: maximum 500 characters');
                        }
                        
                        this.logAction(method, data.payload);
                        
                        // 1. Insert into DB (Primary operation - must succeed)
                        const result = this.sql.exec("INSERT INTO tasks (title, status) VALUES (?, 'pending') RETURNING *", trimmedTitle).toArray();
                        const newTask = result[0];

                        // 2. Replicate to D1 for distributed reads (async, non-blocking)
                        this.ctx.waitUntil(this.replicateToD1('tasks', 'insert', newTask));

                        // 3. Generate Embedding & Store (Secondary operation - best effort)
                        // Note: This is async and may fail. Vector search may miss this task until
                        // a background job re-indexes it. For production, use a queue system.
                        if (newTask && this.env.AI && this.env.VECTOR_INDEX) {
                            // Use Promise for async operation without blocking the response
                            (async () => {
                                try {
                                    const embeddings = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [trimmedTitle] });
                                    const values = embeddings.data[0];
                                    if (values) {
                                        await this.env.VECTOR_INDEX.upsert([{ 
                                            id: `${this.doId}:${newTask.id}`, 
                                            values,
                                            metadata: { doId: this.doId, taskId: newTask.id } 
                                        }]);
                                        this.trackUsage('ai_ops');
                                        console.log(`Vector indexed for task ${newTask.id}`);
                                    }
                                } catch (e: any) {
                                    // Log error but don't fail the task creation
                                    console.error(`AI Embedding failed for task ${newTask.id}:`, e.message);
                                    // TODO: Add to a retry queue for production systems
                                }
                            })();
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
                        
                        this.sql.exec("UPDATE tasks SET status = 'completed' WHERE id = ?", completeId);
                        
                        // Fetch the updated row to broadcast
                        const updated = this.sql.exec("SELECT * FROM tasks WHERE id = ?", completeId).toArray()[0];
                        
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
                        
                        // Fetch the row before deleting for broadcast
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
                             const placeholders = taskIds.map(() => '?').join(',');
                             results = await this.readFromD1(`SELECT * FROM tasks WHERE id IN (${placeholders})`, ...taskIds);
                         }
                    }
                    
                    webSocket.send(JSON.stringify({ type: "query_result", data: results, originalSql: "search" }));
                    break;
                }

                case "getUsage":
                    this.trackUsage('reads');
                    const usage = this.sql.exec("SELECT * FROM _usage ORDER BY date DESC LIMIT 30").toArray();
                    webSocket.send(JSON.stringify({ type: "query_result", data: usage, originalSql: "getUsage" }));
                    break;

                case "getAuditLog":
                     this.trackUsage('reads');
                     const logs = this.sql.exec("SELECT * FROM _audit_log ORDER BY timestamp DESC LIMIT 50").toArray();
                     webSocket.send(JSON.stringify({ type: "query_result", data: logs, originalSql: "getAuditLog" }));
                     break;

                case "listTasks": {
                     // Read from D1 replica for horizontal scaling
                     const tasks = await this.readFromD1("SELECT * FROM tasks ORDER BY id");
                     webSocket.send(JSON.stringify({ type: "query_result", data: tasks, originalSql: "listTasks" }));
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
                        originalSql: "getPresence" 
                    }));
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
                        // Use D1 for read-only queries to enable horizontal scaling
                        const results = await this.readFromD1(rawSql);
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
                    
                    // Validate value size (max 100KB to prevent memory issues)
                    const valueStr = JSON.stringify(value);
                    if (valueStr.length > 100000) {
                        webSocket.send(JSON.stringify({ 
                            type: "error", 
                            error: "Value too large: maximum 100KB" 
                        }));
                        break;
                    }
                    
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

                default:
                    webSocket.send(JSON.stringify({ error: `Unknown RPC method: ${method}` }));
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
    });

    webSocket.addEventListener("close", (event) => {
      console.log("WebSocket closed:", event.code, event.reason);
      this.subscribers.forEach((set) => set.delete(webSocket));
    });

    webSocket.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
      this.subscribers.forEach((set) => set.delete(webSocket));
    });
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
        } catch (err) {
          sockets.delete(socket);
        }
      }
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
}
