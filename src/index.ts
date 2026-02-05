import { DataStore } from "./durable-object";
import { createAuth } from "./lib/auth";
import type { ExecutionContext, ScheduledController } from "cloudflare:workers";

export { DataStore };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Initialize Auth
    const auth = createAuth(env);

    // 1. Handle Auth API Routes (/api/auth/*)
    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    // Look for room_id in query params
    const roomId = url.searchParams.get("room_id");

    if (!roomId) {
        // Only require room_id for DO connections
        // Allow public access to index or other static assets if served from here (though usually Vite handles that)
        return new Response("Missing room_id query parameter", { status: 400 });
    }

    // 2. Protect Database Access
    // Check for session in headers or cookies
    const session = await auth.api.getSession({ headers: request.headers });
    
    // Allow if it is a "Manifest" request for generator (optional, likely wants dev protection)
    // For now, strict protection on everything database related.
    // If dev mode, you might want to skip this or use a specific dev token.
    if (!session) {
         // Fallback for Demo/Dev: If "demo-token" is present in query (from our simple UI), allow it 
         // BUT in production this should be removed or replaced with real auth flow.
         const queryToken = url.searchParams.get("token");
         if (queryToken !== "demo-token") {
             return new Response("Unauthorized", { status: 401 });
         }
         // Mock user for demo token
         request.headers.set("X-User-ID", "demo-user");
    } else {
         // Pass user ID to Durable Object
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
