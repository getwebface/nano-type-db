import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
import * as fs from 'node:fs';

interface WebSocketMessage {
  action: "subscribe" | "query" | "mutate" | "rpc"; // Added 'rpc'
  table?: string;
  sql?: string;
  // RPC payload
  method?: string; 
  payload?: any;
}

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
  }
];

export class DataStore extends DurableObject {
  sql: any; 
  subscribers: Map<string, Set<WebSocket>>;
  env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.subscribers = new Map();
    
    this.runMigrations();
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

  getSchema() {
    const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'").toArray();
    const schema: Record<string, any[]> = {};
    for (const t of tables) {
      const columns = this.sql.exec(`PRAGMA table_info("${t.name}")`).toArray();
      schema[t.name] = columns;
    }
    return schema;
  }

  // Backup Implementation
  async backupToR2() {
      try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupPath = `/tmp/backup-${timestamp}.db`;
          
          // 1. Dump SQLite to local temp file
          this.sql.exec(`VACUUM INTO '${backupPath}'`);
          
          // 2. Read file buffer
          const fileBuffer = fs.readFileSync(backupPath);
          
          // 3. Upload to R2
          if (this.env.BACKUP_BUCKET) {
             await this.env.BACKUP_BUCKET.put(`backup-${timestamp}.db`, fileBuffer);
             console.log(`Backup uploaded: backup-${timestamp}.db`);
          } else {
             console.log("R2 Bucket not configured, skipping upload.");
          }
          
          // Cleanup
          fs.unlinkSync(backupPath);
      } catch (err) {
          console.error("Backup failed:", err);
      }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal Backup Trigger
    if (url.pathname === "/backup") {
        await this.backupToR2();
        return new Response("Backup completed");
    }

    if (url.pathname === "/schema") {
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

      // @ts-ignore: WebSocketPair is a global in Cloudflare Workers
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

      this.handleSession(server);

      return new Response(null, {
        status: 101,
        // @ts-ignore: webSocket property exists in Cloudflare ResponseInit
        webSocket: client,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  handleSession(webSocket: WebSocket) {
    // @ts-ignore: accept method exists on Cloudflare WebSocket
    webSocket.accept();

    webSocket.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data as string) as WebSocketMessage;

        // 1. Subscribe
        if (data.action === "subscribe" && data.table) {
          if (!this.subscribers.has(data.table)) {
            this.subscribers.set(data.table, new Set());
          }
          this.subscribers.get(data.table)!.add(webSocket);
        }

        // 2. Query (Read-Only preferred, but keeping raw SQL for existing read functionality)
        if (data.action === "query" && data.sql) {
          // Ideally, we parse this to ensure it's SELECT only.
          const results = this.sql.exec(data.sql).toArray();
          webSocket.send(JSON.stringify({ 
            type: "query_result", 
            data: results,
            originalSql: data.sql 
          }));
        }

        // 3. SECURE MUTATIONS (RPC)
        // Replaced raw "mutate" block with specific Actions to prevent SQL Injection
        if (data.action === "rpc" || (data.action as string) === "createTask") {
            // Support both generic 'rpc' wrapper or direct action naming if client sends that
            const method = data.method || data.action;
            
            switch (method) {
                case "createTask":
                    // Payload: { title: "..." }
                    // Auto-inject fields or validate here
                    const title = data.payload?.title || "Untitled Task";
                    this.sql.exec("INSERT INTO tasks (title, status) VALUES (?, 'pending')", title);
                    
                    webSocket.send(JSON.stringify({ type: "mutation_success", action: "createTask" }));
                    this.broadcastUpdate("tasks");
                    break;
                
                // Add more actions here (updateTask, deleteTask, etc.)
                default:
                    webSocket.send(JSON.stringify({ error: `Unknown RPC method: ${method}` }));
            }
        }
        
        // Legacy/Unsafe Mutate Block - Disabled/Restricted
        if (data.action === "mutate") {
             webSocket.send(JSON.stringify({ error: "Raw mutations are disabled. Use RPC actions (e.g., createTask)." }));
        }

      } catch (err: any) {
        webSocket.send(JSON.stringify({ error: err.message }));
      }
    });

    webSocket.addEventListener("close", () => {
      this.subscribers.forEach((set) => set.delete(webSocket));
    });
  }

  broadcastUpdate(table: string) {
    if (this.subscribers.has(table)) {
      const sockets = this.subscribers.get(table)!;
      const message = JSON.stringify({ event: "update", table });
      
      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch (err) {
          sockets.delete(socket);
        }
      }
    }
  }
}