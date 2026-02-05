import { DataStore } from "./durable-object";
import type { ExecutionContext, ScheduledController } from "cloudflare:workers";

export { DataStore };

// Mock Auth Verification
// In production, use a library to verify JWT from Supabase/Clerk/Auth0
async function verifyToken(token: string | null): Promise<{ id: string } | null> {
  // For this demo, we accept a hardcoded token or any bearer token
  if (!token) return null;
  // Simulate decoding a JWT
  return { id: "user_demo_123" }; 
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Look for room_id in query params
    const roomId = url.searchParams.get("room_id");

    if (!roomId) {
      return new Response("Missing room_id query parameter", { status: 400 });
    }

    // AUTHENTICATION GUARD
    // Do not let the request reach the Durable Object unless it has a valid User ID.
    // We check Authorization header or query param for WebSocket convenience
    const authHeader = request.headers.get("Authorization");
    const queryToken = url.searchParams.get("token");
    const token = authHeader ? authHeader.replace("Bearer ", "") : queryToken;
    
    const user = await verifyToken(token);
    
    if (!user) {
        return new Response("Unauthorized", { status: 401 });
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

    // Route Schema Introspection (REST API)
    if (url.pathname === "/schema") {
        return stub.fetch(request);
    }

    // Forward standard requests (if any)
    return stub.fetch(request);
  },

  // BACKUP SYSTEM (Cron Job)
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log("Starting scheduled backup...");
    // For this demo, we backup the 'demo-room' or 'tasks' room.
    // In a real app, you might iterate through active IDs if stored, or rely on a different architecture.
    const id = env.DATA_STORE.idFromName("demo-room");
    const stub = env.DATA_STORE.get(id);
    
    // Trigger backup inside the DO
    ctx.waitUntil(stub.fetch("http://do/backup"));
  }
};