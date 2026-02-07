import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { apiKeys, rooms } from "./db/schema";
import { ApiKeySchema } from "./lib/models";
import { NanoStore } from "./durable-object";
import { createAuth } from "./lib/auth";
import { z } from "zod";
import { getAssetFromKV, MethodNotAllowedError, NotFoundError } from "@cloudflare/kv-asset-handler";
// @ts-ignore
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
const assetManifest = JSON.parse(manifestJSON);

export { NanoStore };

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use("*", cors());

// Error Handling
app.onError((err, c) => {
    console.error("Global Error:", err);
    return c.json({ error: err.message }, 500);
});

// =========================================
// Auth Micro-App
// =========================================
const authApp = new Hono<{ Bindings: Env }>();
authApp.all("/*", (c) => {
    const auth = createAuth(c.env);
    return auth.handler(c.req.raw);
});
app.route("/api/auth", authApp);

// =========================================
// API Keys Micro-App
// =========================================
const keysApp = new Hono<{ Bindings: Env }>();

// Generate Key
keysApp.post("/generate", zValidator("json", ApiKeySchema), async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const data = c.req.valid("json");
    const db = drizzle(c.env.AUTH_DB);
    const keyId = `nk_live_${crypto.randomUUID().replace(/-/g, '')}`;
    
    const expiryDate = data.expiresInDays 
        ? new Date(Date.now() + data.expiresInDays * 86400000) 
        : data.expiresInDays === undefined ? new Date(Date.now() + 90 * 86400000) : undefined; 
        // Logic: if undefined default to 90?? Legacy said default 90. Logic above preserves that.
        // Wait, schema has it optional.
    
    const expiresAt = expiryDate ? expiryDate.getTime() : null;

    const newKey = {
        id: keyId,
        userId: session.user.id,
        name: data.name,
        createdAt: Date.now(),
        expiresAt: expiresAt,
        scopes: JSON.stringify(data.scopes),
    };

    await db.insert(apiKeys).values(newKey).run();

    return c.json(newKey);
});

// List Keys
keysApp.get("/list", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const db = drizzle(c.env.AUTH_DB);
    const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, session.user.id)).all();
    
    return c.json({ keys });
});

// Delete Key
keysApp.post("/delete", zValidator("json", z.object({ id: z.string() })), async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    
    const { id } = c.req.valid("json");
    const db = drizzle(c.env.AUTH_DB);
    
    const result = await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, session.user.id))).run();
    
    if (result.meta.changes === 0) {
        return c.json({ error: "Key not found or not owned by user" }, 404);
    }

    return c.json({ success: true });
});

app.route("/api/keys", keysApp);

// =========================================
// Rooms Micro-App
// =========================================
const roomsApp = new Hono<{ Bindings: Env }>();

roomsApp.get("/list", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const db = drizzle(c.env.AUTH_DB);
    const userRooms = await db.select().from(rooms).where(eq(rooms.userId, session.user.id)).all();
    return c.json(userRooms);
});

app.route("/api/rooms", roomsApp);

// =========================================
// WebSocket & DO Routes
// =========================================
app.get("/connect", async (c) => {
    // Check for WebSocket Upgrade
    if (c.req.header("Upgrade") !== "websocket") {
        return c.json({ error: "Expected WebSocket Upgrade" }, 426);
    }

    const roomId = c.req.query("room_id");
    if (!roomId) return c.json({ error: "Missing room_id" }, 400);

    // Get Durable Object
    const id = c.env.DATA_STORE.idFromName(roomId); // Using name for room mapping
    const stub = c.env.DATA_STORE.get(id);

    // Handoff to DO
    return stub.fetch(c.req.raw);
});

// Proxy Schema Request
app.get("/schema", async (c) => {
    const roomId = c.req.query("room_id");
    if (!roomId) return c.json({ error: "Missing room_id" }, 400);

    const id = c.env.DATA_STORE.idFromName(roomId);
    const stub = c.env.DATA_STORE.get(id);
    return stub.fetch(c.req.raw);
});

// Static Assets Fallback
app.get("*", async (c) => {
    try {
        return await getAssetFromKV(
            {
                request: c.req.raw,
                waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
            },
            {
                ASSET_NAMESPACE: c.env.__STATIC_CONTENT,
                ASSET_MANIFEST: assetManifest,
            }
        );
    } catch (e) {
        if (e instanceof NotFoundError) {
             // Fallback to index.html for SPA
             try {
                return await getAssetFromKV(
                    {
                        request: c.req.raw,
                        waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
                    },
                    {
                        ASSET_NAMESPACE: c.env.__STATIC_CONTENT,
                        ASSET_MANIFEST: assetManifest,
                        mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/index.html`, req),
                    }
                );
             } catch (e2) {}
        }
        return c.text("Not Found", 404);
    }
});

// Export type for Hono RPC
export type AppType = typeof app;

export default app;
