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

    // Debug Endpoint (Temporary)
    if (url.pathname === "/debug-auth") {
        const session = await auth.api.getSession({ headers: request.headers });
        return Response.json({ 
            hasSession: !!session, 
            user: session?.user?.id, 
            cookies: request.headers.get("Cookie") 
        });
    }

    // 2. Serve Static Assets (React App)
    if (env.ASSETS) {
      try {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status < 400) {
          return asset;
        }
      } catch (e) {
        // failed to fetch asset, continue
      }
    }

    // 3. Durable Object Interactions (Logic that needs room_id)
    // Only enforce room_id and auth checking for backend/API operations
    const isBackendPath = 
        url.pathname === "/connect" || 
        url.pathname === "/schema" || 
        url.pathname === "/manifest" ||
        request.headers.get("Upgrade") === "websocket";

    if (!isBackendPath) {
       // If not a specific backend path, and asset wasn't found (404 above),
       // fall back to SPA index.html for client-side routing.
       if (env.ASSETS) {
          try {
             // Create a request for index.html
             const indexReq = new Request(new URL("/index.html", url), request);
             const index = await env.ASSETS.fetch(indexReq);
             return index;
          } catch(e) {}
       }
       // If ASSETS not bound or index fail, 404
       return new Response("Not found", { status: 404 });
    }

    // --- Backend Logic Starts Here ---
    
    // Look for room_id in query params.
    const roomId = url.searchParams.get("room_id");

    if (!roomId) {
      return new Response("Missing room_id query parameter", { status: 400 });
    }

    // 4. Protect Database Access
    console.log(`Checking auth for roomId: ${roomId}, path: ${url.pathname}, upgrade: ${request.headers.get("Upgrade")}`);
    
    let session;
    try {
        session = await auth.api.getSession({ 
            headers: request.headers
        });
    } catch (e: any) {
        console.error("Critical Auth Error:", e);
        return new Response(`Auth Error: ${e.message}`, { status: 500 });
    }
    
    // Debugging: If no session, log cookie presence
    if (!session) {
         console.log("Auth failed: No session found");
         console.log("Cookies present:", request.headers.get("Cookie"));
         console.log("Origin:", request.headers.get("Origin"));
         
         return new Response("Unauthorized. Please log in.", { status: 401 });
    } else {
         console.log(`Auth success: User ${session.user.id}`);
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
