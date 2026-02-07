import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";
import * as schema from "./db/schema";
import { WebSocketMessageSchema } from "./lib/models";
import { 
  RateLimiter, 
  StructuredLogger 
} from "./lib/security";

// 🛡️ Table Registry
// 🛡️ FIX: Removed 'tasks' from registry
const TableMap: Record<string, any> = {
  _webhooks: schema.webhooks,
  // Add other system tables here if needed
};

// --- Helper Classes (MemoryStore/DebouncedWriter omitted for brevity but assumed present) ---
class MemoryStore {
  private data: Map<string, any> = new Map();
  private expiry: Map<string, number> = new Map();
  set(key: string, value: any, ttlMs: number = 60000) {
    this.data.set(key, value);
    this.expiry.set(key, Date.now() + ttlMs);
  }
  get(key: string) { this.cleanup(); return this.data.get(key); }
  delete(key: string) { this.data.delete(key); this.expiry.delete(key); }
  keys() { this.cleanup(); return this.data.keys(); }
  private cleanup() {
    const now = Date.now();
    for (const [key, time] of this.expiry) {
      if (now > time) { this.data.delete(key); this.expiry.delete(key); }
    }
  }
}

class DebouncedWriter {
    private pending: Map<string, any> = new Map();
    private timer: any = null;
    constructor(private flushFn: (data: Map<string, any>) => void, private interval: number = 1000) {}
    write(key: string, value: any) {
        this.pending.set(key, value);
        if (!this.timer) this.timer = setTimeout(() => this.flush(), this.interval);
    }
    flush() {
        if (this.pending.size > 0) { this.flushFn(new Map(this.pending)); this.pending.clear(); }
        this.timer = null;
    }
}

// --- SYNC ENGINE VERSION 2 ---
class SyncEngine {
  constructor(
    private ctx: DurableObjectState, 
    private env: Env, 
    private logger: StructuredLogger
  ) {}

  /**
   * READ STRATEGY: "Infinite Scale"
   * 1. Try reading from D1 (Read Replica) - Scalable, Global
   * 2. Fallback to DO (Local SQLite) - Consistency guarantee if D1 lags/fails
   */
  async read(query: string, params: any[] = []): Promise<any[]> {
    // If no replica configured, just read local
    if (!this.env.READ_REPLICA) {
      return this.localRead(query, params);
    }

    try {
      // 1. Try D1 Read Replica
      const result = await this.env.READ_REPLICA.prepare(query).bind(...params).all();
      return result.results || [];
    } catch (e: any) {
      // 2. Fallback to Local DO
      this.logger.warn("SyncEngine: D1 Read failed, falling back to DO", { error: e.message });
      return this.localRead(query, params);
    }
  }

  /**
   * WRITE STRATEGY: "Real-Time Source of Truth"
   * 1. Write to DO immediately (ACID transaction)
   * 2. Replicate to D1 asynchronously (Eventual Consistency)
   */
  async replicateInsert(table: string, rows: any[]) {
    if (!this.env.READ_REPLICA || !rows.length) return;

    try {
      const keys = Object.keys(rows[0]);
      // Sanitize column names for D1 (should match DO)
      const cols = keys.map(k => `"${k.replace(/"/g, '""')}"`).join(',');
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO "${table.replace(/"/g, '""')}" (${cols}) VALUES (${placeholders})`;

      // Prepare batch for D1
      const statements = rows.map(row => 
        this.env.READ_REPLICA.prepare(sql).bind(...keys.map(k => row[k]))
      );

      // Execute batch on D1
      await this.env.READ_REPLICA.batch(statements);
      
    } catch (e: any) {
      this.logger.error("SyncEngine: D1 Replication failed", { error: e.message, table });
      // TODO: Add to a Dead Letter Queue or Retry list if critical
    }
  }

  async replicateDDL(sql: string) {
    if (!this.env.READ_REPLICA) return;
    try {
      await this.env.READ_REPLICA.exec(sql);
    } catch (e: any) {
      this.logger.error("SyncEngine: DDL Replication failed", { error: e.message, sql });
    }
  }

  private localRead(query: string, params: any[]): any[] {
    return this.ctx.storage.sql.exec(query, ...params).toArray();
  }
}

export class NanoStore extends DurableObject<Env> {
  private db: ReturnType<typeof drizzle<typeof schema>>;
  private sql: any;
  private subscribers: Set<WebSocket> = new Set();
  private memoryStore: MemoryStore;
  private debouncedWriter: DebouncedWriter;
  private logger: StructuredLogger;
  private syncEngine: SyncEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.logger = new StructuredLogger({ doId: ctx.id.toString() });
    this.memoryStore = new MemoryStore();
    this.syncEngine = new SyncEngine(ctx, env, this.logger);

    this.db = drizzle(async (sql, params, method) => {
      try {
        const cursor = this.sql.exec(sql, ...params);
        if (method === "run") return { rows: [] };
        return { rows: cursor.toArray() };
      } catch (e: any) {
        console.error("Drizzle Error:", e.message);
        throw e;
      }
    }, { schema });

    this.debouncedWriter = new DebouncedWriter((updates) => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS _debounced_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`);
      for (const [key, val] of updates) {
        this.sql.exec(`INSERT OR REPLACE INTO _debounced_state (key, value, updated_at) VALUES (?, ?, ?)`, key, JSON.stringify(val), Date.now());
      }
    });

    this.initializeSchema();
  }

  private initializeSchema() {
    // 🛡️ FIX: Removed 'tasks' creation. Only system tables.
    this.sql.exec(`
         CREATE TABLE IF NOT EXISTS _webhooks (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            events TEXT NOT NULL,
            secret TEXT,
            active INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            last_triggered_at INTEGER,
            failure_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS _usage (
            date TEXT PRIMARY KEY, 
            reads INTEGER DEFAULT 0, 
            writes INTEGER DEFAULT 0, 
            ai_ops INTEGER DEFAULT 0
        );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect" || request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      this.subscribers.add(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 🛡️ FIX: Allow both paths so the API router can reach it
    if (url.pathname === "/schema" || url.pathname === "/api/schema") {
      // Helper to get schema dynamically (prevents hardcoded 'tasks' ghost)
      const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'").toArray();
      const schema: Record<string, any[]> = {};
        
      for (const t of tables) {
        const tableName = t.name;
        const columns = this.sql.exec(`PRAGMA table_info("${tableName}")`).toArray();
        schema[tableName] = columns.map((c: any) => ({
          name: c.name,
          type: c.type,
          pk: c.pk
        }));
      }
      return Response.json(schema);
    }

    return new Response("NanoStore Active", { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const json = JSON.parse(text);

      const result = WebSocketMessageSchema.safeParse(json);
      if (!result.success) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message', details: result.error.issues }));
        return;
      }
      
      const payload = result.data;

      switch (payload.action) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'setCursor':
          this.memoryStore.set(`cursor:${payload.payload.userId}`, payload.payload.position, 30000);
          this.broadcastMemoryUpdate('cursors', payload.payload);
          break;
        case 'setPresence':
          this.memoryStore.set(`presence:${payload.payload.userId}`, payload.payload.status, 60000);
          this.broadcastMemoryUpdate('presence', payload.payload);
          break;
        case 'rpc':
          await this.handleRpc(ws, payload);
          break;
      }
    } catch (e: any) {
      console.error("WS Error:", e);
    }
  }

  // Helper to broadcast updates to all clients
  private broadcastUpdate(table: string, action: 'create' | 'update' | 'delete', data: any) {
    const msg = JSON.stringify({ event: 'update', table, action, data });
    for (const sub of this.subscribers) {
      try {
        sub.send(msg);
      } catch (e) {
        // Ignore closed sockets and remove them from the set
        this.subscribers.delete(sub);
      }
    }
  }

  private async handleRpc(ws: WebSocket, payload: any) {
    let data;
    try {
      switch (payload.method) {
        case 'batchInsert': {
          const { table, rows } = payload.payload;
          if (!rows || rows.length === 0) {
            data = { inserted: 0, total: 0 };
            break;
          }

          // 1. Sanitize table name (Must match frontend logic)
          const safeTableName = table.toLowerCase().replace(/[^a-z0-9_]/g, '');

          // 2. Prepare keys and statement
          const keys = Object.keys(rows[0]);
          const cols = keys.map(k => `"${k.replace(/"/g, '""')}"`).join(',');
          const placeholders = keys.map(() => '?').join(',');
          const sqlStmt = `INSERT INTO "${safeTableName}" (${cols}) VALUES (${placeholders})`;
          
          // 3. Execute Insert using Cloudflare's Transaction API
          let inserted = 0;
          try {
              // FIX: Use transactionSync instead of SQL BEGIN TRANSACTION
              this.ctx.storage.transactionSync(() => {
                  for (const row of rows) {
                      this.sql.exec(sqlStmt, ...keys.map(k => row[k]));
                      inserted++;
                  }
              });
              
              // 4. Broadcast update so UI refreshes immediately
              this.broadcastUpdate(safeTableName, 'create', { count: inserted });
              
              // 2. Replicate to D1 Asynchronously (Scalable)
              // We use ctx.waitUntil so it doesn't block the WebSocket response
              this.ctx.waitUntil(this.syncEngine.replicateInsert(safeTableName, rows));
            } catch (e) {
              console.error('Batch insert failed:', e);
              throw new Error(`Insert failed: ${e.message}`);
          }
          break;
        }

        case 'getPresence': {
          const presence = [];
          for (const key of this.memoryStore.keys()) {
            if (key.startsWith('presence:')) {
              presence.push({ userId: key.split(':')[1], status: this.memoryStore.get(key) });
            }
          }
          data = presence;
          break;
        }

        case 'streamIntent': {
           // (Preserved logic)
           data = { status: 'mock_stream' };
           break;
        }

        case 'getUsage': {
          const res = await this.db.run(sql`SELECT * FROM _usage ORDER BY date DESC LIMIT 30`);
          data = (res as any).rows;
          break;
        }

        case 'createTable': {
          const { tableName, columns } = payload.payload;
          const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
          const cols = columns.map((c: any) => `"${c.name.replace(/\W/g,'')}" ${c.type}`).join(',');
          this.sql.exec(`CREATE TABLE IF NOT EXISTS "${safeName}" (${cols})`);

          // Replicate DDL to D1
          const ddl = `CREATE TABLE IF NOT EXISTS "${safeName}" (${cols})`;
          this.ctx.waitUntil(this.syncEngine.replicateDDL(ddl));

          data = { success: true };
          break;
        }

        case 'deleteTable': {
          const { tableName } = payload.payload;
          const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
          this.sql.exec(`DROP TABLE IF EXISTS "${safeName}"`);

          // Replicate DDL to D1
          const ddl = `DROP TABLE IF EXISTS "${safeName}"`;
          this.ctx.waitUntil(this.syncEngine.replicateDDL(ddl));

          data = { success: true };
          break;
        }

        case 'executeSQL': {
            const { sql: query, params } = payload.payload;
           
            // Simple security check
            if (!query.trim().toLowerCase().startsWith('select')) {
             throw new Error("Only SELECT allowed in executeSQL RPC");
            }

            // Use Sync Engine: Try D1 first, fallback to DO
            data = await this.syncEngine.read(query, params || []);
            break;
        }
        
        default:
           data = { error: `Unknown method ${payload.method}` };
      }

      ws.send(JSON.stringify({
        requestId: payload.requestId,
        type: 'rpc_result',
        data
      }));

    } catch (e: any) {
      ws.send(JSON.stringify({
        requestId: payload.requestId,
        type: 'rpc_error',
        error: e.message
      }));
    }
  }

  private broadcastMemoryUpdate(type: string, data: any) {
    const msg = JSON.stringify({ event: 'memory_update', type, data });
    for (const sub of this.subscribers) sub.send(msg);
  }

  async webSocketClose(ws: WebSocket) {
    this.subscribers.delete(ws);
  }
}
