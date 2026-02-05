import { DataStore } from "./durable-object";
import { createAuth } from "./lib/auth";
import type { ExecutionContext, ScheduledController } from "cloudflare:workers";

export { DataStore };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

    // 0. Rate Limiting Protection
    if (env.RATE_LIMITER) {
        const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
        if (!success) {
            return new Response("Rate limit exceeded. Please slow down.", { status: 429 });
        }
    }
    
    // Initialize Auth
    const auth = createAuth(env);

    // 1. Handle Auth API Routes (/api/auth/*)
    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    // Look for room_id in query params
    const roomId = url.searchParams.get("room_id");

    if (!roomId) {
        return new Response("Missing room_id query parameter", { status: 400 });
    }

    // 2. Protect Database Access
    const session = await auth.api.getSession({ headers: request.headers });
    
    if (!session) {
         // Fallback for Demo/Dev
         const queryToken = url.searchParams.get("token");
         if (queryToken !== "demo-token") {
             return new Response("Unauthorized", { status: 401 });
         }
         request.headers.set("X-User-ID", "demo-user");
    } else {
         request.headers.set("X-User-ID", session.user.id);
    }

    // Get the Durable Object ID from the room name
    const id = env.DATA_STORE.idFromName(roomId);
    
    // Get the stub
    const stub = env.DATA_STORE.get(id);

    // Route websocket upgrades
    if (request.headers.get("Upgrade") === "websocket") {
       const newUrl = new URL(request.url);
       newUrl.pathname = "/connect";
       const newRequest = new Request(newUrl.toString(), request);
       return stub.fetch(newRequest);
    }

    // Route Schema Introspection & Manifest
    if (url.pathname === "/schema" || url.pathname === "/manifest") {
        return stub.fetch(request);
    }

    // Forward standard requests (if any)
    return stub.fetch(request);
  },

  // BACKUP SYSTEM (Cron Job)
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log("Starting scheduled backup...");
    const id = env.DATA_STORE.idFromName("demo-room");
    const stub = env.DATA_STORE.get(id);
    ctx.waitUntil(stub.fetch("http://do/backup"));
  }
};
