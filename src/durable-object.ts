import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";
import * as schema from "./db/schema";
import { WebSocketMessageSchema } from "./lib/models";

// Table Registry: Maps string names to Drizzle Schema Objects.
// This allows type-safe Drizzle operations for known tables
// while falling back to raw SQL only for dynamic user-created tables.
const TableMap: Record<string, any> = {
    tasks: schema.tasks,
    _webhooks: schema.webhooks,
};

export class NanoStore extends DurableObject {
    private db: ReturnType<typeof drizzle<typeof schema>>;
    private sql: any; // Native Cloudflare SqlStorage

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;

        // Proxy Drizzle Async -> DO Synchronous Storage
        this.db = drizzle(async (sqlQuery, params, method) => {
            try {
                const cursor = this.sql.exec(sqlQuery, ...params);
                
                if (method === "run") {
                    return { rows: [] }; 
                }
                
                const rows = cursor.toArray();
                return { rows: rows };
            } catch (e: any) {
                console.error("Drizzle Proxy Error:", e.message);
                throw e;
            }
        }, { schema });

        this.initializeSchema();
    }

    private initializeSchema() {
        // DDL for schema creation — the only acceptable use of raw SQL for static tables.
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
        this.sql.exec(`
            CREATE TABLE IF NOT EXISTS _usage (
                date TEXT PRIMARY KEY, 
                reads INTEGER DEFAULT 0, 
                writes INTEGER DEFAULT 0, 
                ai_ops INTEGER DEFAULT 0
            )
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

        // Keep legacy schema endpoint for now, but frontend should prefer Hono RPC
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

            // Zod Validation Firewall
            const result = WebSocketMessageSchema.safeParse(json);
            if (!result.success) {
                console.error("Invalid WS message:", result.error);
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    error: 'Invalid message format', 
                    details: result.error.issues 
                }));
                return;
            }

            const payload = result.data;

            switch (payload.action) {
                case 'create_task':
                    // Type-Safe Drizzle Insert
                    await this.db.insert(schema.tasks).values({
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
                            // --- DDL Operations (Kept as Raw SQL per "Anti-Ghost" Rules) ---
                            case 'createTable': {
                                const { tableName, columns } = payload.payload;
                                const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
                                const colDefs = columns.map((c: any) => {
                                    const safeColName = c.name.replace(/[^a-zA-Z0-9_]/g, '');
                                    let def = `"${safeColName}" ${c.type}`;
                                    if (c.primaryKey) def += ' PRIMARY KEY';
                                    if (c.notNull) def += ' NOT NULL';
                                    return def;
                                }).join(', ');
                                this.sql.exec(`CREATE TABLE IF NOT EXISTS "${safeTableName}" (${colDefs})`);
                                responseData = { success: true, table: safeTableName };
                                break;
                            }
                            case 'deleteTable': {
                                const { tableName } = payload.payload;
                                const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
                                this.sql.exec(`DROP TABLE IF EXISTS "${safeTableName}"`);
                                responseData = { success: true };
                                break;
                            }

                            // --- DML Operations (Refactored to Drizzle) ---

                            case 'batchInsert': {
                                const { table, rows } = payload.payload;
                                if (!rows || rows.length === 0) {
                                    responseData = { inserted: 0, total: 0 };
                                    break;
                                }

                                // Check if table is in our Registry for type-safe Drizzle insert
                                const knownTable = TableMap[table];

                                if (knownTable) {
                                    // Type-Safe Drizzle Batch Insert for known tables
                                    await this.db.insert(knownTable).values(rows).run();
                                    responseData = { data: { inserted: rows.length, total: rows.length } };
                                } else {
                                    // Fallback: Raw SQL for dynamic user-created tables not in schema.ts
                                    const keys = Object.keys(rows[0]);
                                    if (!keys.every(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))) {
                                        throw new Error("Invalid column names in CSV");
                                    }

                                    const placeholders = keys.map(() => '?').join(',');
                                    const stmt = this.sql.prepare(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${placeholders})`);
                                    
                                    let inserted = 0;
                                    const CHUNK_SIZE = 100;
                                    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                                        const chunk = rows.slice(i, i + CHUNK_SIZE);
                                        for (const row of chunk) {
                                            try {
                                                stmt.run(...keys.map(k => row[k]));
                                                inserted++;
                                            } catch (e) {
                                                console.error('Insert failed row:', e);
                                            }
                                        }

                                        if (i + CHUNK_SIZE < rows.length) {
                                            await new Promise(resolve => setTimeout(resolve, 0));
                                            ws.send(JSON.stringify({
                                                type: 'import_progress',
                                                current: i + chunk.length,
                                                total: rows.length
                                            }));
                                        }
                                    }
                                    responseData = { data: { inserted, total: rows.length } };
                                }
                                break;
                            }

                            case 'listTasks': {
                                // Drizzle Query Builder
                                const limit = payload.payload.limit || 500;
                                const offset = payload.payload.offset || 0;
                                const taskRows = await this.db.select()
                                    .from(schema.tasks)
                                    .limit(limit)
                                    .offset(offset);
                                responseData = taskRows;
                                break;
                            }

                            case 'getUsage': {
                                try {
                                    // Drizzle sql template tag through the proxy pipeline
                                    const usage = await this.db.run(
                                        sql`SELECT * FROM _usage ORDER BY date DESC LIMIT 30`
                                    );
                                    responseData = (usage as any).rows ?? [];
                                } catch (e) {
                                    console.error("getUsage error", e);
                                    responseData = [];
                                }
                                break;
                            }

                            case 'getSchema': {
                                // System query — safe to keep raw as it queries sqlite_master
                                const tables = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'").toArray();
                                const schemaInfo: Record<string, any[]> = {};
                                
                                for (const t of tables) {
                                    const tblName = t.name;
                                    const columns = this.sql.exec(`PRAGMA table_info("${tblName}")`).toArray();
                                    schemaInfo[tblName] = columns.map((c: any) => ({
                                        name: c.name,
                                        type: c.type,
                                        pk: c.pk
                                    }));
                                }
                                responseData = schemaInfo;
                                break;
                            }

                            case 'executeSQL': {
                                // Raw SQL interface for the SQL Runner console
                                const { sql: rawSql, params } = payload.payload;
                                const res = this.sql.exec(rawSql, ...(params || [])).toArray();
                                responseData = res;
                                break;
                            }

                            default:
                                responseData = { status: 'mock_response', method: payload.method };
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
                    // Legacy raw SQL proxy for subscribe_query/query actions
                    try {
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
