import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";

interface WebSocketMessage {
  action: "subscribe" | "query" | "mutate";
  table?: string;
  sql?: string;
}

export class DataStore extends DurableObject {
  sql: any; // Using any to bypass specific strict typing for the new SqlStorage API in this environment
  subscribers: Map<string, Set<WebSocket>>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Initialize SQLite storage
    this.sql = ctx.storage.sql;
    // Initialize subscriber map: Table Name -> Set of WebSockets
    this.subscribers = new Map();
    
    // Seed database if empty (For demo purposes)
    this.seedDatabase();
  }

  seedDatabase() {
    try {
      const tableExists = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").toArray();
      if (tableExists.length === 0) {
        this.sql.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT)`);
        this.sql.exec(`INSERT INTO tasks (title, status) VALUES ('Buy milk', 'pending'), ('Walk the dog', 'completed')`);
      }
    } catch (err) {
      console.error("Error seeding database:", err);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

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
          // Execute Query
          const results = this.sql.exec(data.sql).toArray();
          webSocket.send(JSON.stringify({ 
            type: "query_result", 
            data: results,
            originalSql: data.sql 
          }));
        }

        if (data.action === "mutate" && data.sql && data.table) {
          // Execute Mutation
          this.sql.exec(data.sql);
          
          // Send success back to sender
          webSocket.send(JSON.stringify({ type: "mutation_success", sql: data.sql }));

          // Broadcast update to subscribers
          this.broadcastUpdate(data.table);
        }

      } catch (err: any) {
        webSocket.send(JSON.stringify({ error: err.message }));
      }
    });

    webSocket.addEventListener("close", () => {
      // Cleanup subscribers
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
