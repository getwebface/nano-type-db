import { NanoStore } from "./durable-object";
import { createAuth } from "./lib/auth";
import { SecurityHeaders, InputValidator } from "./lib/security";
import type { ExecutionContext, ScheduledController, MessageBatch } from "cloudflare:workers";

export { NanoStore, NanoStore as DataStore };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // User Tier Endpoint
    if (url.pathname === "/api/user-tier") {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
            return SecurityHeaders.apply(
                new Response("Unauthorized", { status: 401 })
            );
        }

        try {
            const userTier = await env.AUTH_DB.prepare(
                "SELECT tier FROM user WHERE id = ?"
            ).bind(session.user.id).first();

            return SecurityHeaders.apply(
                Response.json({ 
                    tier: userTier?.tier || 'free'
                })
            );
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Error fetching user tier: ${e.message}`, { status: 500 })
            );
        }
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
        url.pathname === "/download-client" ||
        // Ensure API routes (like /api/keys) are handled by the backend
        url.pathname.startsWith("/api/") ||
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

    // Handle API Key Management Endpoints
    if (url.pathname === "/api/keys/generate") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Auth Error: ${e.message}`, { status: 500 })
            );
        }
        
        if (!session) {
            return SecurityHeaders.apply(
                new Response("Unauthorized. Please log in.", { status: 401 })
            );
        }

        if (request.method !== "POST") {
            return SecurityHeaders.apply(
                new Response("Method not allowed", { status: 405 })
            );
        }

        // SECURITY: Validate request body
        let body: { name?: string; expiresInDays?: number };
        try {
            body = await request.json() as { name?: string; expiresInDays?: number };
        } catch (e) {
            return SecurityHeaders.apply(
                new Response("Invalid JSON body", { status: 400 })
            );
        }
        
        // Generate secure API key
        const keyId = `nk_live_${crypto.randomUUID().replace(/-/g, '')}`;
        
        // SECURITY: Validate and set expiration date
        // Ensure expiresInDays is positive (default: 90 days, max: 365 days)
        let expiresInDays = 90; // default
        if (body.expiresInDays !== undefined) {
            const daysInput = Number(body.expiresInDays);
            if (isNaN(daysInput) || daysInput <= 0) {
                return SecurityHeaders.apply(
                    new Response("expiresInDays must be a positive number", { status: 400 })
                );
            }
            expiresInDays = Math.min(daysInput, 365);
        }
        const expiresAt = Date.now() + (expiresInDays * 24 * 60 * 60 * 1000);
        
        // SECURITY: Sanitize key name using InputValidator
        const keyName = InputValidator.sanitizeString(body.name || "Unnamed Key", 100, false) || "Unnamed Key";
        
        try {
            await env.AUTH_DB.prepare(
                "INSERT INTO api_keys (id, user_id, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
            ).bind(keyId, session.user.id, keyName, Date.now(), expiresAt).run();

            return SecurityHeaders.apply(
                Response.json({ 
                    id: keyId, 
                    name: keyName, 
                    created_at: Date.now(),
                    expires_at: expiresAt,
                    expires_in_days: expiresInDays
                })
            );
        } catch (e: any) {
            console.error("Failed to create API key:", e);
            return SecurityHeaders.apply(
                new Response(`Failed to create API key: ${e.message}`, { status: 500 })
            );
        }
    }

    if (url.pathname === "/api/keys/list") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Auth Error: ${e.message}`, { status: 500 })
            );
        }
        
        if (!session) {
            return SecurityHeaders.apply(
                new Response("Unauthorized. Please log in.", { status: 401 })
            );
        }

        try {
            const result = await env.AUTH_DB.prepare(
                "SELECT id, name, created_at, last_used_at, expires_at, scopes FROM api_keys WHERE user_id = ?"
            ).bind(session.user.id).all();

            return SecurityHeaders.apply(
                Response.json(result.results || [])
            );
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Failed to list API keys: ${e.message}`, { status: 500 })
            );
        }
    }

    if (url.pathname === "/api/keys/delete") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Auth Error: ${e.message}`, { status: 500 })
            );
        }
        
        if (!session) {
            return SecurityHeaders.apply(
                new Response("Unauthorized. Please log in.", { status: 401 })
            );
        }

        if (request.method !== "POST") {
            return SecurityHeaders.apply(
                new Response("Method not allowed", { status: 405 })
            );
        }

        // SECURITY: Validate request body
        let body: { id: string };
        try {
            body = await request.json() as { id: string };
        } catch (e) {
            return SecurityHeaders.apply(
                new Response("Invalid JSON body", { status: 400 })
            );
        }
        
        if (!body.id || !body.id.startsWith("nk_")) {
            return SecurityHeaders.apply(
                new Response("Invalid API key ID", { status: 400 })
            );
        }
        
        try {
            // SECURITY: Ensure user can only delete their own keys
            await env.AUTH_DB.prepare(
                "DELETE FROM api_keys WHERE id = ? AND user_id = ?"
            ).bind(body.id, session.user.id).run();

            return SecurityHeaders.apply(
                Response.json({ success: true })
            );
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Failed to delete API key: ${e.message}`, { status: 500 })
            );
        }
    }

    // Handle Room Management Endpoints
    if (url.pathname === "/api/rooms/list") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Auth Error: ${e.message}`, { status: 500 })
            );
        }
        
        if (!session) {
            return SecurityHeaders.apply(
                new Response("Unauthorized. Please log in.", { status: 401 })
            );
        }

        try {
            const result = await env.AUTH_DB.prepare(
                "SELECT id, name, created_at, last_accessed_at FROM rooms WHERE user_id = ? ORDER BY last_accessed_at DESC"
            ).bind(session.user.id).all();

            return SecurityHeaders.apply(
                Response.json(result.results || [])
            );
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Failed to list rooms: ${e.message}`, { status: 500 })
            );
        }
    }

    if (url.pathname === "/api/rooms/create") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Auth Error: ${e.message}`, { status: 500 })
            );
        }
        
        if (!session) {
            return SecurityHeaders.apply(
                new Response("Unauthorized. Please log in.", { status: 401 })
            );
        }

        if (request.method !== "POST") {
            return SecurityHeaders.apply(
                new Response("Method not allowed", { status: 405 })
            );
        }

        let body: { roomId?: string; name?: string };
        try {
            body = await request.json() as { roomId?: string; name?: string };
        } catch (e) {
            return SecurityHeaders.apply(
                new Response("Invalid JSON body", { status: 400 })
            );
        }

        // Validate room ID
        const roomId = InputValidator.sanitizeString(body.roomId || "", 50, false);
        if (!roomId || roomId.length < 3) {
            return SecurityHeaders.apply(
                new Response("Room ID must be at least 3 characters", { status: 400 })
            );
        }

        const name = InputValidator.sanitizeString(body.name || roomId, 100, false);

        try {
            // Check plan limits
            const limitsResult = await env.AUTH_DB.prepare(
                "SELECT max_rooms FROM plan_limits WHERE user_id = ?"
            ).bind(session.user.id).first();

            const maxRooms = limitsResult?.max_rooms || 3; // Default to free tier

            // Count existing rooms
            const countResult = await env.AUTH_DB.prepare(
                "SELECT COUNT(*) as count FROM rooms WHERE user_id = ?"
            ).bind(session.user.id).first();

            const currentCount = (countResult as any)?.count || 0;

            if (currentCount >= maxRooms) {
                return SecurityHeaders.apply(
                    new Response(`Plan limit reached. Maximum ${maxRooms} rooms allowed.`, { status: 403 })
                );
            }

            // Check if room ID already exists
            const existingRoom = await env.AUTH_DB.prepare(
                "SELECT id FROM rooms WHERE id = ?"
            ).bind(roomId).first();

            if (existingRoom) {
                return SecurityHeaders.apply(
                    new Response("Room ID already exists", { status: 409 })
                );
            }

            // Create room
            await env.AUTH_DB.prepare(
                "INSERT INTO rooms (id, user_id, name, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?)"
            ).bind(roomId, session.user.id, name, Date.now(), Date.now()).run();

            return SecurityHeaders.apply(
                Response.json({ 
                    id: roomId, 
                    name: name,
                    created_at: Date.now(),
                    last_accessed_at: Date.now()
                })
            );
        } catch (e: any) {
            console.error("Failed to create room:", e);
            return SecurityHeaders.apply(
                new Response(`Failed to create room: ${e.message}`, { status: 500 })
            );
        }
    }

    if (url.pathname === "/api/rooms/delete") {
        let session;
        try {
            session = await auth.api.getSession({ headers: request.headers });
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Auth Error: ${e.message}`, { status: 500 })
            );
        }
        
        if (!session) {
            return SecurityHeaders.apply(
                new Response("Unauthorized. Please log in.", { status: 401 })
            );
        }

        if (request.method !== "POST") {
            return SecurityHeaders.apply(
                new Response("Method not allowed", { status: 405 })
            );
        }

        let body: { roomId: string };
        try {
            body = await request.json() as { roomId: string };
        } catch (e) {
            return SecurityHeaders.apply(
                new Response("Invalid JSON body", { status: 400 })
            );
        }
        
        if (!body.roomId) {
            return SecurityHeaders.apply(
                new Response("Invalid room ID", { status: 400 })
            );
        }
        
        try {
            // Ensure user can only delete their own rooms
            await env.AUTH_DB.prepare(
                "DELETE FROM rooms WHERE id = ? AND user_id = ?"
            ).bind(body.roomId, session.user.id).run();

            return SecurityHeaders.apply(
                Response.json({ success: true })
            );
        } catch (e: any) {
            return SecurityHeaders.apply(
                new Response(`Failed to delete room: ${e.message}`, { status: 500 })
            );
        }
    }

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
    let isApiKey = false;
    
    // PRIORITY 1: Check for API Key Header (for external apps)
    const apiKey = request.headers.get("X-Nano-Key") || url.searchParams.get("api_key");
    
    if (apiKey?.startsWith("nk_")) {
        // Validate API Key against D1 with expiration and scope checking
        try {
            const keyRecord = await env.AUTH_DB.prepare(
                "SELECT id, user_id, expires_at, scopes FROM api_keys WHERE id = ?"
            ).bind(apiKey).first();
            
            if (keyRecord) {
                // SECURITY: Check if key has expired
                if (keyRecord.expires_at && Date.now() > keyRecord.expires_at) {
                    return new Response("API key expired", { status: 401 });
                }
                
                // SECURITY: Validate scopes (if implemented)
                // For now, we just check if key has any scopes defined
                // In the future, check specific scopes based on the requested action
                
                isApiKey = true;
                // Mock a session for the DO
                session = { user: { id: keyRecord.user_id, role: "developer" } };
                
                // Update last_used_at asynchronously (best effort)
                ctx.waitUntil(
                    env.AUTH_DB.prepare(
                        "UPDATE api_keys SET last_used_at = ? WHERE id = ?"
                    ).bind(Date.now(), apiKey).run()
                );
            } else {
                return new Response("Invalid API key", { status: 401 });
            }
        } catch (e: any) {
            console.error("API Key validation error:", e);
            return new Response(`API Key validation failed: ${e.message}`, { status: 500 });
        }
    }
    
    // PRIORITY 2: Browser Cookies (Production/Same-Domain)
    if (!session) {
        try {
            session = await auth.api.getSession({ 
                headers: request.headers
            });

            // PRIORITY 3: URL Token (Dev/Cross-Origin fallback)
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
    }
    
    if (!session) {
         console.log("Auth failed: No session found");
         return new Response("Unauthorized: Invalid API Key or Session", { status: 401 });
    }

    console.log(`Auth success: User ${session.user.id}${isApiKey ? ' (API Key)' : ''}`);

    // Validate room exists in registry (unless using API key for backward compatibility)
    if (!isApiKey) {
        try {
            const roomExists = await env.AUTH_DB.prepare(
                "SELECT id FROM rooms WHERE id = ? AND user_id = ?"
            ).bind(roomId, session.user.id).first();

            if (!roomExists) {
                // Auto-register existing rooms for backward compatibility
                console.log(`Auto-registering room ${roomId} for user ${session.user.id}`);
                try {
                    await env.AUTH_DB.prepare(
                        "INSERT OR IGNORE INTO rooms (id, user_id, name, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?)"
                    ).bind(roomId, session.user.id, roomId, Date.now(), Date.now()).run();
                } catch (insertError) {
                    console.error("Failed to auto-register room:", insertError);
                    // Continue anyway for backward compatibility
                }
            } else {
                // Update last accessed time for registered rooms
                ctx.waitUntil(
                    env.AUTH_DB.prepare(
                        "UPDATE rooms SET last_accessed_at = ? WHERE id = ? AND user_id = ?"
                    ).bind(Date.now(), roomId, session.user.id).run()
                );
            }
        } catch (e: any) {
            console.error("Room validation error:", e);
            // Continue anyway to maintain backward compatibility
        }
    }

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
         newUrl.pathname = "/connect"; // Match the DO's expected path
         
         // 🔴 FIX: Explicitly preserve the WebSocket handshake headers
         const wsHeaders = new Headers(newHeaders);
         wsHeaders.set("Upgrade", "websocket");
         wsHeaders.set("Connection", "Upgrade");

         // Create fresh request with the forced headers
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
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    // Webhook Queue Consumer
    for (const message of batch.messages) {
      try {
        const { webhookId, url, secret, payload } = message.body as {
          webhookId: string;
          url: string;
          secret: string | null;
          payload: any;
        };
        
        // Prepare webhook request
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'NanoTypeDB-Webhooks/1.0'
        };
        
        // Add HMAC signature if secret is provided
        if (secret) {
          const encoder = new TextEncoder();
          const data = encoder.encode(JSON.stringify(payload));
          const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          const signature = await crypto.subtle.sign('HMAC', key, data);
          const hashArray = Array.from(new Uint8Array(signature));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          headers['X-Webhook-Signature'] = `sha256=${hashHex}`;
        }
        
        // Dispatch webhook
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unable to read response');
          console.error(`Webhook ${webhookId} to ${url} failed: ${response.status} ${response.statusText} - ${errorText}`);
          // Retry will be handled by Cloudflare Queue's max_retries config
          message.retry();
        } else {
          console.log(`Webhook ${webhookId} delivered successfully`);
          message.ack();
        }
      } catch (error: any) {
        console.error('Webhook delivery error:', error.message);
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    // Queue Consumer for AI Embedding with Retry Logic
    console.log(`Processing embedding batch: ${batch.messages.length} messages`);
    
    interface EmbeddingJob {
      taskId: number;
      doId: string;
      title: string;
      timestamp: number;
    }
    
    for (const message of batch.messages) {
      // Type-safe access to message body
      const job = message.body as EmbeddingJob;
      const { taskId, doId, title, timestamp } = job;
      
      try {
        console.log(`Processing embedding for task ${taskId} in DO ${doId}`);
        
        // Generate embedding using AI
        const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [title] });
        const values = embeddings.data[0];
        
        if (values && env.VECTOR_INDEX) {
          // Upsert to Vector Index
          await env.VECTOR_INDEX.upsert([{
            id: `${doId}:${taskId}`,
            values,
            metadata: { doId, taskId }
          }]);
          
          // Update status in Durable Object
          const doIdObj = env.DATA_STORE.idFromString(doId);
          const stub = env.DATA_STORE.get(doIdObj);
          
          // Call internal endpoint to update vector status
          await stub.fetch("http://do/internal/update-vector-status", {
            method: "POST",
            body: JSON.stringify({ taskId, status: 'indexed', values })
          });
          
          console.log(`✅ Embedding indexed for task ${taskId}`);
          
          // Log to Analytics Engine (standardized format)
          if (env.ANALYTICS) {
            ctx.waitUntil(
              env.ANALYTICS.writeDataPoint({
                blobs: [doId, 'ai_embedding_success'],
                doubles: [taskId, Date.now() - timestamp], // task_id, processing_time_ms
                indexes: [`task_${taskId}`]
              })
            );
          }
          
          // Acknowledge success
          message.ack();
        } else {
          throw new Error('No embedding values returned from AI');
        }
      } catch (error: any) {
        console.error(`❌ Embedding failed for task ${taskId} in DO ${doId}:`, error.message);
        
        // Log failure to Analytics Engine (standardized format)
        if (env.ANALYTICS) {
          ctx.waitUntil(
            env.ANALYTICS.writeDataPoint({
              blobs: [doId, 'ai_embedding_failure'],
              doubles: [taskId, message.attempts || 0], // task_id, retry_count
              indexes: [`error_${Date.now()}`]
            })
          );
        }
        
        // Retry (message will be retried automatically up to max_retries)
        // After max_retries, it goes to dead letter queue
        message.retry();
      }
    }
  }
};
