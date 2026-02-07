import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { tasks, webhooks } from "./db/schema";
import { WebSocketMessageSchema } from "./lib/models";
import { eq } from "drizzle-orm";

export class NanoStore extends DurableObject {
    private db: ReturnType<typeof drizzle>;
    private sql: any; // Cloudflare SqlStorage

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;

        // Initialize Drizzle with sqlite-proxy for synchronous DO storage
        this.db = drizzle(async (sql, params, method) => {
            try {
                const cursor = this.sql.exec(sql, ...params);
                const rows = cursor.toArray();
                
                // SQLite specific implementation for result metadata is limited in DOs currently
                // handling based on method type if needed
                if (method === "run") {
                    return { rows: [], changes: 0, lastInsertRowid: 0 }; 
                }
                return { rows: rows };
            } catch (e: any) {
                console.error("Drizzle Proxy Error:", e.message);
                throw e;
            }
        });

        // Initialize Schema (Ghost-Busting: Explicit Schema Init)
        this.initializeSchema();
    }

    private initializeSchema() {
        // Ensure core tables exist
        this.sql.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                status TEXT,
                owner_id TEXT
            );
        `);
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
        `);
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Core WebSocket Handoff
        if (url.pathname === "/connect" || request.headers.get("Upgrade") === "websocket") {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            
            // Accept the WebSocket connection
            this.ctx.acceptWebSocket(server);
            
            return new Response(null, { status: 101, webSocket: client });
        }

        if (url.pathname === "/schema") {
            return Response.json({
                tables: [
                    { name: 'tasks', columns: ['id', 'title', 'status', 'owner_id'] },
                    { name: '_webhooks', columns: ['id', 'url', 'events', 'secret', 'active', 'created_at'] }
                ]
            });
        }

        return new Response("NanoStore DO Ready", { status: 200 });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        try {
            const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
            const json = JSON.parse(text);

            // Zod Validation
            const result = WebSocketMessageSchema.safeParse(json);
            if (!result.success) {
                console.error("Invalid WS message:", result.error);
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    error: 'Invalid message format', 
                    details: result.error.extractErrors() 
                }));
                return;
            }

            const payload = result.data;

            // Handle Actions
            switch (payload.action) {
                case 'create_task':
                    await this.db.insert(tasks).values({
                        title: payload.data.title,
                        status: payload.data.status || 'pending',
                        ownerId: payload.data.ownerId || 'anonymous'
                    }).run();
                    ws.send(JSON.stringify({ type: 'task_created', success: true }));
                    break;
                
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    break;

                case 'rpc':
                    try {
                        let responseData;
                        switch (payload.method) {
                            case 'getPresence':
                                responseData = []; 
                                break;
                            case 'streamIntent':
                                responseData = { status: 'mock_stream' };
                                break;
                            case 'createTable':{
                                const { tableName, columns } = payload.payload;
                                // Sanitize table name (basic)
                                const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
                                
                                const colDefs = columns.map((c: any) => {
                                    const safeColName = c.name.replace(/[^a-zA-Z0-9_]/g, '');
                                    let def = `"${safeColName}" ${c.type}`;
                                    if (c.primaryKey) def += ' PRIMARY KEY';
                                    if (c.notNull) def += ' NOT NULL';
                                    return def;
                                }).join(', ');
                                
                                try {
                                    this.sql.exec(`CREATE TABLE IF NOT EXISTS "${safeTableName}" (${colDefs})`);
                                    responseData = { success: true, table: safeTableName };
                                } catch (e: any) {
                                    throw new Error(`Failed to create table: ${e.message}`);
                                }
                                break;
                            }
                            case 'deleteTable': {
                                const { tableName } = payload.payload;
                                this.sql.exec(`DROP TABLE IF EXISTS ${tableName}`);
                                responseData = { success: true };
                                break;
                            }
                            case 'batchInsert': {
                                const { table, rows } = payload.payload;
                                if (!rows || rows.length === 0) {
                                    responseData = { inserted: 0, total: 0 };
                                    break;
                                }
                                
                                const keys = Object.keys(rows[0]);
                                const placeholders = keys.map(() => '?').join(',');
                                const stmt = this.sql.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`);
                                
                                let inserted = 0;
                                for (const row of rows) {
                                    try {
                                        stmt.run(...keys.map(k => row[k]));
                                        inserted++;
                                    } catch (e) {
                                        console.error('Insert failed row:', e);
                                    }
                                }
                                responseData = { data: { inserted, total: rows.length } };
                                break;
                            }
                            case 'executeSQL': {
                                const { sql, params } = payload.payload;
                                const res = this.sql.exec(sql, ...(params || [])).toArray();
                                responseData = res;
                                break;
                            }
                            case 'getSchema': {
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
                                responseData = schema;
                                break;
                            }
                            case 'getUsage': {
                                try {
                                    // ensure _usage table exists
                                    this.sql.exec(`CREATE TABLE IF NOT EXISTS _usage (date TEXT PRIMARY KEY, reads INTEGER DEFAULT 0, writes INTEGER DEFAULT 0, ai_ops INTEGER DEFAULT 0)`);
                                    const usage = this.sql.exec("SELECT * FROM _usage ORDER BY date DESC LIMIT 30").toArray();
                                    responseData = usage;
                                } catch (e) {
                                    console.error("getUsage error", e);
                                    responseData = [];
                                }
                                break;
                            }
                            case 'listTasks': {
                                // Legacy support
                                const res = this.sql.exec("SELECT * FROM tasks LIMIT ? OFFSET ?", payload.payload.limit || 500, payload.payload.offset || 0).toArray();
                                responseData = res;
                                break;
                            }
                            default:
                                throw new Error(`Unknown RPC method: ${payload.method}`);
                        }
                        
                        ws.send(JSON.stringify({
                            requestId: payload.requestId,
                            data: responseData
                        }));
                    } catch (e: any) {
                         ws.send(JSON.stringify({ 
                            requestId: payload.requestId,
                            error: e.message
                         }));
                    }
                    break;
                
                case 'subscribe_query':
                case 'query':
                    // Mock query response for ghost-busting phase
                    // Ideally check payload.sql and run against this.db
                    // SECURITY WARNING: In production, do not allow raw SQL from client!
                    // This is a legacy feature we are supporting.
                    try {
                        // Very basic unsafe proxy for legacy support
                        const res = this.sql.exec(payload.sql).toArray();
                        ws.send(JSON.stringify({
                             type: 'query_result',
                             data: res,
                             sql: payload.sql
                        }));
                    } catch (e: any) {
                         ws.send(JSON.stringify({ type: 'error', error: e.message }));
                    }
                    break;

                case 'setCursor':
                case 'setPresence':
                    // Broadcast to other clients (not implemented in this minimal scope, but acknowledged)
                    break;
            }

        } catch (e: any) {
            console.error("WS Handler Error:", e);
            ws.send(JSON.stringify({ type: 'error', error: e.message }));
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        // Cleanup if necessary
    }
}
