import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";
import * as schema from "./db/schema";
import { WebSocketMessageSchema } from "./lib/models";
import { 
  RateLimiter, 
  InputValidator, 
  MemoryTracker, 
  StructuredLogger 
} from "./lib/security";

// 🛡️ Table Registry: Maps string names to Drizzle Schema Objects
const TableMap: Record<string, any> = {
    tasks: schema.tasks,
    _webhooks: schema.webhooks,
    // Add other static tables here
};

// --- Helper Classes (Preserved from Original) ---

class MemoryStore {
  private data: Map<string, any> = new Map();
  private expiry: Map<string, number> = new Map();
  
  set(key: string, value: any, ttlMs: number = 60000): void {
    this.data.set(key, value);
    this.expiry.set(key, Date.now() + ttlMs);
  }
  
  get(key: string): any {
    this.cleanup();
    return this.data.get(key);
  }
  
  delete(key: string): void {
    this.data.delete(key);
    this.expiry.delete(key);
  }

  keys(): IterableIterator<string> {
    this.cleanup();
    return this.data.keys();
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, time] of this.expiry) {
      if (now > time) {
        this.data.delete(key);
        this.expiry.delete(key);
      }
    }
  }
}

class DebouncedWriter {
  private pending: Map<string, any> = new Map();
  private timer: any = null;
  
  constructor(private flushFn: (data: Map<string, any>) => void, private interval: number = 1000) {}
  
  write(key: string, value: any) {
    this.pending.set(key, value);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.interval);
    }
  }
  
  flush() {
    if (this.pending.size > 0) {
      this.flushFn(new Map(this.pending));
      this.pending.clear();
    }
    this.timer = null;
  }
}

// --- Main Durable Object ---

export class NanoStore extends DurableObject<Env> {
  private db: ReturnType<typeof drizzle<typeof schema>>;
  private sql: any;
  private subscribers: Set<WebSocket> = new Set();
  
  // Feature Sub-Systems
  private memoryStore: MemoryStore;
  private debouncedWriter: DebouncedWriter;
  private logger: StructuredLogger;
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private psychicSentCache: WeakMap<WebSocket, Set<string>> = new WeakMap();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.logger = new StructuredLogger({ doId: ctx.id.toString() });
    this.memoryStore = new MemoryStore();

    // Initialize Drizzle Proxy
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

    // Initialize Debounced Writer
    this.debouncedWriter = new DebouncedWriter((updates) => {
      // Flush logic using raw SQL for the kv table (or refactor to Drizzle if schema exists)
      this.sql.exec(`CREATE TABLE IF NOT EXISTS _debounced_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`);
      const stmt = this.sql.prepare(`INSERT OR REPLACE INTO _debounced_state (key, value, updated_at) VALUES (?, ?, ?)`);
      for (const [key, val] of updates) {
        stmt.run(key, JSON.stringify(val), Date.now());
      }
    });

    this.initializeSchema();
  }

  private initializeSchema() {
    // DDL for core tables needed by DO logic
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        status TEXT,
        owner_id TEXT,
        vector_status TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS _webhooks (
        id TEXT PRIMARY KEY,
        url TEXT,
        events TEXT,
        secret TEXT,
        active INTEGER,
        created_at INTEGER,
        last_triggered_at INTEGER,
        failure_count INTEGER
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

    return new Response("NanoStore Active", { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const json = JSON.parse(text);

      // 🛡️ Validate with Zod
      const result = WebSocketMessageSchema.safeParse(json);
      if (!result.success) {
        // Allow legacy messages if they don't match strict schema, OR send error
        // For migration safety, we log and try to handle known legacy shapes manually if needed
        // But here we enforce the new schema.
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

  private async handleRpc(ws: WebSocket, payload: any) {
    let data;
    try {
      switch (payload.method) {
        // --- 1. Drizzle-Refactored DML ---
        case 'listTasks': {
          const limit = payload.payload.limit || 500;
          const offset = payload.payload.offset || 0;
          data = await this.db.select().from(schema.tasks).limit(limit).offset(offset);
          break;
        }

        case 'batchInsert': {
          const { table, rows } = payload.payload;
          if (!rows?.length) { data = { inserted: 0 }; break; }

          const knownTable = TableMap[table];
          if (knownTable) {
            // Safe Drizzle Insert
            await this.db.insert(knownTable).values(rows).run();
            data = { inserted: rows.length };
          } else {
            // Raw SQL Fallback for Dynamic Tables
            const keys = Object.keys(rows[0]);
            const placeholders = keys.map(() => '?').join(',');
            const stmt = this.sql.prepare(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${placeholders})`);
            let count = 0;
            for (const row of rows) {
              stmt.run(...keys.map(k => row[k]));
              count++;
            }
            data = { inserted: count };
          }
          break;
        }

        // --- 2. Preserved Feature Logic ---
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
          // Psychic Search Feature
          const text = payload.payload.text;
          if (!this.env.AI) { data = { error: 'AI not configured' }; break; }
          
          const embedding = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [text] });
          const vectors = await this.env.VECTOR_INDEX.query(embedding.data[0], { topK: 5 });
          
          // Filter and fetch from DB
          const ids = vectors.matches.map(m => m.id.split(':')[1]);
          // Use Drizzle with 'inArray'
          if (ids.length > 0) {
             // Note: inArray requires importing it from drizzle-orm
             // Fallback to raw for complex IN clause if needed or simple iteration
             // Keeping it simple for this snippet:
             const placeholders = ids.map(() => '?').join(',');
             const results = this.sql.exec(`SELECT * FROM tasks WHERE id IN (${placeholders})`, ...ids).toArray();
             
             ws.send(JSON.stringify({ type: 'psychic_push', data: results }));
          }
          data = { status: 'streaming' };
          break;
        }

        case 'subscribeSemantic': {
          // Semantic Reflex Logic
          const { topic, description, threshold } = payload.payload;
          if (this.env.AI) {
            const emb = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [description] });
            this.memoryStore.set(`semantic_sub:${topic}:${Date.now()}`, {
              topic, vector: emb.data[0], threshold, socket: ws
            }, 3600000); // 1 hour TTL
            data = { subscribed: true };
          }
          break;
        }

        case 'getUsage': {
          // Using Drizzle SQL Template Tag
          const res = await this.db.run(sql`SELECT * FROM _usage ORDER BY date DESC LIMIT 30`);
          data = (res as any).rows;
          break;
        }

        // --- 3. DDL Exceptions (Raw SQL) ---
        case 'createTable': {
          const { tableName, columns } = payload.payload;
          const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
          const cols = columns.map((c: any) => `"${c.name.replace(/\W/g,'')}" ${c.type}`).join(',');
          this.sql.exec(`CREATE TABLE IF NOT EXISTS "${safeName}" (${cols})`);
          data = { success: true };
          break;
        }

        case 'deleteTable': {
          const { tableName } = payload.payload;
          const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
          this.sql.exec(`DROP TABLE IF EXISTS "${safeName}"`);
          data = { success: true };
          break;
        }

        case 'executeSQL': {
           // SQL Console
           const { sql: query, params } = payload.payload;
           // Basic read-only check
           if (!query.trim().toLowerCase().startsWith('select')) throw new Error("Only SELECT allowed");
           data = this.sql.exec(query, ...(params || [])).toArray();
           break;
        }
        
        // Default
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
    for (const sub of this.subscribers) {
      sub.send(msg);
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.subscribers.delete(ws);
  }
}
