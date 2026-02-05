import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
// `node:fs` is not available in Cloudflare Workers; file-system backups
// are only performed when running in a Node environment. In Workers
// we skip file-based backups and rely on R2 or other mechanisms.

interface WebSocketMessage {
  action: "subscribe" | "query" | "mutate" | "rpc";
  table?: string;
  sql?: string;
  method?: string; 
  payload?: any;
  updateId?: string; // For optimistic updates
}

// 1. Define the Manifest explicitly
// Added 'search' to actions
const ACTIONS = {
  createTask: { params: ["title"] },
  completeTask: { params: ["id"] },
  deleteTask: { params: ["id"] },
  search: { params: ["query"] },
  getUsage: { params: [] },
  getAuditLog: { params: [] }
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
  }
];

export class DataStore extends DurableObject {
  sql: any; 
  subscribers: Map<string, Set<WebSocket>>;
  env: Env;
  doId: string;
  tableSnapshots: Map<string, any[]>; // Cache of last known table state

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.subscribers = new Map();
    this.tableSnapshots = new Map();
    this.doId = ctx.id.toString();
    
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

  getSchema() {
    const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'").toArray();
    const schema: Record<string, any[]> = {};
    for (const t of tables) {
      const columns = this.sql.exec(`PRAGMA table_info("${t.name}")`).toArray();
      schema[t.name] = columns;
    }
    return schema;
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

        if (data.action === "subscribe" && data.table) {
          if (!this.subscribers.has(data.table)) {
            this.subscribers.set(data.table, new Set());
          }
          this.subscribers.get(data.table)!.add(webSocket);
        }

        if (data.action === "query" && data.sql) {
          this.trackUsage('reads');
          const results = this.sql.exec(data.sql).toArray();
          webSocket.send(JSON.stringify({ 
            type: "query_result", 
            data: results,
            originalSql: data.sql 
          }));
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
                        this.logAction(method, data.payload);
                        const title = data.payload?.title || "Untitled Task";
                        
                        // 1. Insert into DB
                        const result = this.sql.exec("INSERT INTO tasks (title, status) VALUES (?, 'pending') RETURNING id", title).toArray();
                        const newId = result[0]?.id;

                        // 2. Generate Embedding (Async) & Store
                        if (newId && this.env.AI && this.env.VECTOR_INDEX) {
                            try {
                                const embeddings = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [title] });
                                const values = embeddings.data[0];
                                if (values) {
                                    // Namespace ID with DO ID to prevent collision if index is shared
                                    await this.env.VECTOR_INDEX.upsert([{ 
                                        id: `${this.doId}:${newId}`, 
                                        values,
                                        metadata: { doId: this.doId, taskId: newId } 
                                    }]);
                                    this.trackUsage('ai_ops');
                                }
                            } catch (e) {
                                console.error("AI Embedding failed", e);
                            }
                        }

                        webSocket.send(JSON.stringify({ 
                            type: "mutation_success", 
                            action: "createTask",
                            updateId: data.updateId
                        }));
                        this.broadcastUpdate("tasks");
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
                        this.logAction(method, data.payload);
                        if (data.payload?.id) {
                            this.sql.exec("UPDATE tasks SET status = 'completed' WHERE id = ?", data.payload.id);
                            webSocket.send(JSON.stringify({ 
                                type: "mutation_success", 
                                action: "completeTask",
                                updateId: data.updateId
                            }));
                            this.broadcastUpdate("tasks");
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
                        this.logAction(method, data.payload);
                        if (data.payload?.id) {
                            this.sql.exec("DELETE FROM tasks WHERE id = ?", data.payload.id);
                            // Also delete from Vector Index
                            if (this.env.VECTOR_INDEX) {
                                this.env.VECTOR_INDEX.deleteByIds([`${this.doId}:${data.payload.id}`]).catch(console.error);
                            }
                            webSocket.send(JSON.stringify({ 
                                type: "mutation_success", 
                                action: "deleteTask",
                                updateId: data.updateId
                            }));
                            this.broadcastUpdate("tasks");
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
                    if (!query) {
                        webSocket.send(JSON.stringify({ type: "query_result", data: [], originalSql: "search" }));
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
                             results = this.sql.exec(`SELECT * FROM tasks WHERE id IN (${placeholders})`, ...taskIds).toArray();
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

                default:
                    webSocket.send(JSON.stringify({ error: `Unknown RPC method: ${method}` }));
            }
        }
        
        if (data.action === "mutate") {
             webSocket.send(JSON.stringify({ error: "Raw mutations are disabled. Use RPC actions." }));
        }

      } catch (err: any) {
        webSocket.send(JSON.stringify({ error: err.message }));
      }
    });

    webSocket.addEventListener("close", () => {
      this.subscribers.forEach((set) => set.delete(webSocket));
    });
  }

  calculateDiff(oldData: any[], newData: any[]): { added: any[], modified: any[], deleted: any[] } {
    const oldMap = new Map(oldData.map(row => [row.id, row]));
    const newMap = new Map(newData.map(row => [row.id, row]));
    
    const added: any[] = [];
    const modified: any[] = [];
    const deleted: any[] = [];
    
    // Find added and modified
    for (const [id, newRow] of newMap) {
      const oldRow = oldMap.get(id);
      if (!oldRow) {
        added.push(newRow);
      } else if (JSON.stringify(oldRow) !== JSON.stringify(newRow)) {
        modified.push(newRow);
      }
    }
    
    // Find deleted
    for (const [id, oldRow] of oldMap) {
      if (!newMap.has(id)) {
        deleted.push(oldRow);
      }
    }
    
    return { added, modified, deleted };
  }

  broadcastUpdate(table: string) {
    if (this.subscribers.has(table)) {
      const sockets = this.subscribers.get(table)!;
      
      // Fetch current table state
      const currentData = this.sql.exec(`SELECT * FROM ${table}`).toArray();
      const previousData = this.tableSnapshots.get(table) || [];
      
      // Calculate diff
      const diff = this.calculateDiff(previousData, currentData);
      
      // Update snapshot
      this.tableSnapshots.set(table, currentData);
      
      // Send diff to subscribers
      const message = JSON.stringify({ 
        event: "update", 
        table,
        diff,
        fullData: currentData // Send full data for initial load or fallback
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
}
