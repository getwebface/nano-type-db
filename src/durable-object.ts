import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";

interface WebSocketMessage {
  action: "subscribe" | "query" | "mutate";
  table?: string;
  sql?: string;
}

const MIGRATIONS = [
  {
    version: 1,
    up: (sql: any) => {
      sql.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT)`);
      // Seed initial data only if table was empty/just created
      const count = sql.exec("SELECT count(*) as c FROM tasks").toArray()[0].c;
      if (count === 0) {
        sql.exec(`INSERT INTO tasks (title, status) VALUES ('Buy milk', 'pending'), ('Walk the dog', 'completed')`);
      }
    }
  },
  // Add version 2 here in the future:
  // { version: 2, up: (sql) => sql.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'low'") }
];

export class DataStore extends DurableObject {
  sql: any; 
  subscribers: Map<string, Set<WebSocket>>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.subscribers = new Map();
    
    this.runMigrations();
  }

  runMigrations() {
    // 1. Create migrations table if not exists
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT)`);

    // 2. Get current version
    const lastMigration = this.sql.exec("SELECT max(version) as v FROM _migrations").toArray()[0];
    let currentVersion = lastMigration.v || 0;

    // 3. Apply new migrations
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        try {
          migration.up(this.sql);
          this.sql.exec("INSERT INTO _migrations (version, applied_at) VALUES (?, datetime('now'))", migration.version);
          console.log(`Applied migration v${migration.version}`);
        } catch (e) {
          console.error(`Migration v${migration.version} failed:`, e);
          throw e; // Stop startup if migration fails
        }
      }
    }
  }

  getSchema() {
    // Introspection: Get all user tables
    const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'").toArray();
    
    const schema: Record<string, any[]> = {};
    for (const t of tables) {
      const columns = this.sql.exec(`PRAGMA table_info("${t.name}")`).toArray();
      schema[t.name] = columns;
    }
    return schema;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Schema Endpoint for Introspection (The "Type" in NanoType)
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

        if (data.action === "subscribe" && data.table) {
          if (!this.subscribers.has(data.table)) {
            this.subscribers.set(data.table, new Set());
          }
          this.subscribers.get(data.table)!.add(webSocket);
        }

        // Security Note: In a production app, you would validate 'data.sql' here.
        // For the "Security Shield", we would prefer specific actions like "createTask"
        // rather than raw SQL. But for this generic DB tool, we allow raw SQL 
        // effectively acting as the "Admin" user.
        if (data.action === "query" && data.sql) {
          const results = this.sql.exec(data.sql).toArray();
          webSocket.send(JSON.stringify({ 
            type: "query_result", 
            data: results,
            originalSql: data.sql 
          }));
        }

        if (data.action === "mutate" && data.sql && data.table) {
          this.sql.exec(data.sql);
          webSocket.send(JSON.stringify({ type: "mutation_success", sql: data.sql }));
          this.broadcastUpdate(data.table);
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
