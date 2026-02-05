import { NanoStore } from "./durable-object";
import { createAuth } from "./lib/auth";
import type { ExecutionContext, ScheduledController } from "cloudflare:workers";

export { NanoStore, NanoStore as DataStore };

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

    // Debug Endpoint
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

    // 3. Routing Checks
    const isBackendPath = 
        url.pathname === "/connect" || 
        url.pathname === "/schema" || 
        url.pathname === "/manifest" ||
        request.headers.get("Upgrade") === "websocket";

    if (!isBackendPath) {
       if (env.ASSETS) {
          try {
             const indexReq = new Request(new URL("/index.html", url), request);
             return await env.ASSETS.fetch(indexReq);
          } catch(e) {}
       }
       return new Response("Not found", { status: 404 });
    }

    // --- Backend Logic ---

    // Handle Global Query
    if (url.pathname === "/global-query") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return new Response(`Auth Error: ${e.message}`, { status: 500 });
        }
        
        if (!session) {
            return new Response("Unauthorized. Please log in.", { status: 401 });
        }
        
        // ... (Global query logic remains same, omitted for brevity) ...
        // Note: Ideally moving the implementation to a separate function 
        // would clean this up, but keeping it inline for this paste.
        // For now, returning 405 if not POST since we are focusing on WS fix.
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        
        // Re-implementing the body parsing briefly to ensure code completeness
        const body = await request.json() as { sql: string; rooms?: string[] };
        const rooms = body.rooms || [];
        const results = await Promise.all(
            rooms.map(async (roomId: string) => {
                try {
                    const id = env.DATA_STORE.idFromName(roomId);
                    const stub = env.DATA_STORE.get(id);
                    const response = await stub.fetch(new Request(`http://do/query?sql=${encodeURIComponent(body.sql)}`));
                    const data = await response.json();
                    return { roomId, data, success: true };
                } catch (error: any) {
                    return { roomId, error: error.message, success: false };
                }
            })
        );
        const aggregated = results.filter(r => r.success).flatMap(r => (r as any).data);
        return Response.json({
            total: aggregated.length,
            rooms: results.length,
            data: aggregated,
            errors: results.filter(r => !r.success)
        });
    }
    
    const roomId = url.searchParams.get("room_id");
    if (!roomId) {
      return new Response("Missing room_id query parameter", { status: 400 });
    }

    // 4. Protect Database Access
    console.log(`Checking auth for roomId: ${roomId}, path: ${url.pathname}`);
    
    let session;
    try {
        // PRIORITY 1: Browser Cookies (Production/Same-Domain)
        session = await auth.api.getSession({ 
            headers: request.headers
        });

        // PRIORITY 2: URL Token (Dev/Cross-Origin fallback)
        if (!session) {
            const sessionToken = url.searchParams.get("session_token");
            if (sessionToken) {
                session = await auth.api.getSession({ 
                    headers: new Headers({
                        'Cookie': `better-auth.session_token=${sessionToken}`
                    })
                });
            }
        }
    } catch (e: any) {
        console.error("Critical Auth Error:", e);
        return new Response(`Auth Error: ${e.message}`, { status: 500 });
    }
    
    if (!session) {
         console.log("Auth failed: No session found");
         return new Response("Unauthorized. Please log in.", { status: 401 });
    }

    console.log(`Auth success: User ${session.user.id}`);

    // --- CRITICAL FIX START ---
    // Instead of modifying the immutable 'request', we create a new Mutable request
    // with the User ID header added.
    const newHeaders = new Headers(request.headers);
    newHeaders.set("X-User-ID", session.user.id);

    // Get Durable Object ID
    const id = env.DATA_STORE.idFromName(roomId);
    const stub = env.DATA_STORE.get(id);

    // WebSocket Upgrade
    if (request.headers.get("Upgrade") === "websocket") {
       try {
         const newUrl = new URL(request.url);
         newUrl.pathname = "/connect";
         
         // 🟢 FIXED CODE: explicitly preserve Upgrade headers
         const wsHeaders = new Headers(newHeaders);
         wsHeaders.set("Upgrade", "websocket");
         wsHeaders.set("Connection", "Upgrade");

         const wsRequest = new Request(newUrl.toString(), {
             headers: wsHeaders,
             method: request.method
         });
         
         return stub.fetch(wsRequest);
       } catch (error: any) {
         console.error("WebSocket upgrade failed:", error);
         return new Response(`WebSocket upgrade failed: ${error.message}`, { status: 500 });
       }
    }

    // Standard Request (Schema/Manifest)
    // Pass the modified headers here too
    const stdRequest = new Request(request, {
        headers: newHeaders
    });
    return stub.fetch(stdRequest);
    // --- CRITICAL FIX END ---
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log("Starting scheduled backup...");
    const id = env.DATA_STORE.idFromName("demo-room");
    const stub = env.DATA_STORE.get(id);
    ctx.waitUntil(stub.fetch("http://do/backup"));
  }
};
