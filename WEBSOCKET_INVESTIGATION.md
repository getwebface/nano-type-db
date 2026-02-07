# WebSocket Connection Troubleshooting Report

## Error Message
```
WebSocket connection to 'wss://nanotype-db.josh-f96.workers.dev/websocket?room_id' failed
```

## Investigation Summary

This report documents the complete WebSocket connection architecture in nano-type-db and identifies potential issues causing connection failures.

---

## WebSocket Connection Flow

### 1. Client-Side Connection (Frontend)

**File:** `hooks/useDatabase.tsx`

The client uses **PartySocket** (from `partysocket` library) to establish WebSocket connections:

```typescript
// Line 166-181: WebSocket URL construction
const BASE_WS_URL = `${WS_PROTOCOL}://${HOST}/${WS_BASE_PATH}`;
// WS_PROTOCOL: 'wss' for https, 'ws' for http
// WS_BASE_PATH: '__ws/websocket' in dev, 'websocket' in production

const wsUrl = useMemo(() => {
    const url = new URL(BASE_WS_URL);
    if (resolvedRoomId) {
        url.searchParams.set('room_id', resolvedRoomId);
    }
    if (apiKey) {
        url.searchParams.set('key', apiKey);
    }
    return url.toString();
}, [BASE_WS_URL, resolvedRoomId, apiKey]);

// Line 183-231: PartySocket connection
const partySocket = useWebSocket(wsUrl, undefined, {
    enabled: Boolean(resolvedRoomId),
    onOpen: () => { /* ... */ },
    onMessage: (event) => { /* ... */ },
    onClose: (event) => { /* ... */ },
    onError: (error) => { /* ... */ }
});
```

**Key Points:**
- Uses `partysocket` library for WebSocket management
- In development: connects to `ws://localhost:3000/__ws/websocket?room_id=XXX`
- In production: connects to `wss://nanotype-db.josh-f96.workers.dev/websocket?room_id=XXX`
- URL includes `room_id` query parameter (REQUIRED)
- Optional `key` parameter for API key authentication

---

### 2. Development Proxy (Vite)

**File:** `vite.config.ts`

In development, Vite proxies WebSocket requests:

```typescript
// Lines 19-26: WebSocket proxy configuration
proxy: {
    '/__ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__ws/, ''),
    }
}
```

**Development Flow:**
1. Client connects to: `ws://localhost:3000/__ws/websocket?room_id=XXX`
2. Vite proxy rewrites to: `ws://localhost:8787/websocket?room_id=XXX`
3. Request reaches Cloudflare Worker (running locally via wrangler)

---

### 3. Worker Entry Point (Edge Worker)

**File:** `src/index.ts`

The Cloudflare Worker handles incoming WebSocket upgrade requests:

```typescript
// Line 1361-1364: Extract room_id parameter
const roomId = url.searchParams.get("room_id");
if (!roomId) {
    return new Response("Missing room_id query parameter", { status: 400 });
}

// Lines 1366-1450: Authentication
// PRIORITY 1: Check for API Key (X-Nano-Key header or 'key' query param)
// PRIORITY 2: Browser cookies (Better Auth session)
// PRIORITY 3: URL token (session_token query param)

// Lines 1500-1534: Forward to Durable Object
const id = env.DATA_STORE.idFromName(roomId);
const stub = env.DATA_STORE.get(id);

if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const newUrl = new URL(request.url);
    newUrl.pathname = "/connect"; // ⚠️ CRITICAL: Route changes to /connect
    
    // Preserve WebSocket headers
    const wsHeaders = new Headers(newHeaders);
    wsHeaders.set("Upgrade", "websocket");
    wsHeaders.set("Connection", "Upgrade");
    
    const wsRequest = new Request(newUrl.toString(), {
        headers: wsHeaders,
        method: request.method
    });
    
    return stub.fetch(wsRequest);
}
```

**Critical Authentication Flow:**
1. **API Key** (if `key` query param or `X-Nano-Key` header present):
   - Validates against `api_keys` table in AUTH_DB (D1 database)
   - Checks expiration (`expires_at`)
   - Sets `X-User-ID` header from `user_id` field
   
2. **Session Cookie** (Browser):
   - Uses Better Auth to validate session from cookies
   - Sets `X-User-ID` header from session

3. **Session Token** (Query param):
   - Tries `session_token` query parameter
   - Validates with Better Auth
   - Sets `X-User-ID` header

**Authentication Headers Added:**
- `X-User-ID`: User ID from authenticated session (CRITICAL for Durable Object)
- `X-Room-ID`: The room identifier

---

### 4. Durable Object WebSocket Handler

**File:** `src/durable-object.ts`

The Durable Object accepts and manages WebSocket connections:

```typescript
// Lines 1688-1717: /connect endpoint
if (url.pathname === "/connect") {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // Get userId from header (set by Worker)
    const userId = request.headers.get("X-User-ID") || "anonymous";

    // Create WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

    this.handleSession(server, userId);

    return new Response(null, {
        status: 101,
        webSocket: client,
    });
}

// Lines 1722-1738: Session handler
handleSession(webSocket: WebSocket, userId: string) {
    // Register WebSocket with Durable Object
    this.ctx.acceptWebSocket(webSocket);
    
    // Store userId for Row Level Security
    this.webSocketUserIds.set(webSocket, userId);

    // Send reset message (for reconnection scenarios)
    webSocket.send(JSON.stringify({ type: "reset" }));
}
```

---

## Identified Issues & Root Causes

### ❌ Issue 1: Missing `room_id` Query Parameter

**Error Pattern:** `WebSocket connection to 'wss://nanotype-db.josh-f96.workers.dev/websocket?room_id' failed`

**Root Cause:** The URL shows `?room_id` without a value (empty string)

**Location:** Client-side (hooks/useDatabase.tsx, line 169)

```typescript
const resolvedRoomId = useMemo(() => {
    if (roomId) return roomId;
    return new URLSearchParams(window.location.search).get('room_id') || '';
}, [roomId]);
```

**Problem:** 
- If `roomId` state is empty AND URL doesn't have `?room_id=`, the value is `''` (empty string)
- Worker (src/index.ts:1361) checks: `if (!roomId)` which should reject empty string
- BUT the query parameter IS present in the URL, just without a value

**Fix:**
```typescript
// Worker should also validate non-empty room_id
if (!roomId || roomId.trim() === '') {
    return new Response("Missing or empty room_id query parameter", { status: 400 });
}
```

---

### ❌ Issue 2: Authentication Failures

**Root Cause:** WebSocket connections require authentication before upgrade

**Authentication Requirements:**
1. **API Key**: Must be valid, not expired, and belong to valid user
2. **Session Cookie**: Must be valid Better Auth session
3. **Session Token**: Must be valid Better Auth token

**Failure Points:**

1. **Missing Authentication:**
   ```typescript
   // Line 1451-1464 in src/index.ts
   if (!session) {
       console.error("Unauthorized access attempt to room:", roomId);
       return new Response("Unauthorized. Please log in.", { status: 401 });
   }
   ```

2. **Expired API Key:**
   ```typescript
   // Line 1383-1386 in src/index.ts
   if (keyRecord.expires_at && Date.now() > keyRecord.expires_at) {
       return new Response("API key expired", { status: 401 });
   }
   ```

3. **Invalid API Key:**
   ```typescript
   // Line 1402-1404 in src/index.ts
   if (!keyRecord) {
       return new Response("Invalid API key", { status: 401 });
   }
   ```

---

### ❌ Issue 3: Missing Upgrade Headers

**Root Cause:** WebSocket upgrade requires specific headers

**Required Headers:**
- `Upgrade: websocket`
- `Connection: Upgrade`

**Potential Issue:** PartySocket may not be setting headers correctly, or they're being stripped

**Current Fix (src/index.ts:1509-1512):**
```typescript
// Explicitly preserve WebSocket headers
const wsHeaders = new Headers(newHeaders);
wsHeaders.set("Upgrade", "websocket");
wsHeaders.set("Connection", "Upgrade");
```

---

### ❌ Issue 4: Cloudflare Workers Routing

**Root Cause:** Path mismatch between Worker and Durable Object

**Worker forwards to:** `/connect` (line 1507)
**Durable Object expects:** `/connect` (line 1688)

**Potential Issue:** If the Worker's path rewrite fails or Cloudflare routing changes, connection fails

---

### ⚠️ Issue 5: CORS and Cross-Origin Issues

**Potential Issue:** Production URL suggests external domain access

**Current Setup:**
- Production: `wss://nanotype-db.josh-f96.workers.dev/websocket`
- Client connects from potentially different origin

**Security Headers (src/lib/security.ts):**
```typescript
SecurityHeaders.apply(response) // Adds CORS headers
```

**Potential Fix Needed:**
- Ensure CORS allows WebSocket upgrades
- Verify `Access-Control-Allow-Origin` includes client origin
- Check `Access-Control-Allow-Credentials` for cookie-based auth

---

## Debugging Steps

### 1. Check Browser Console

Look for specific error messages:
```javascript
// Open browser DevTools > Console
// Look for WebSocket errors with details
```

### 2. Check Network Tab

1. Open DevTools > Network
2. Filter for "WS" (WebSocket)
3. Look for the failed connection
4. Check:
   - Request Headers (Upgrade, Connection)
   - Response Status (should be 101 Switching Protocols)
   - Query Parameters (room_id should have value)

### 3. Check Worker Logs

```bash
# Tail Cloudflare Worker logs
wrangler tail

# Or check dashboard:
# https://dash.cloudflare.com > Workers & Pages > nanotype-db > Logs
```

Look for:
- "Missing room_id query parameter"
- "Unauthorized access attempt"
- "WebSocket upgrade failed"
- "Invalid Upgrade header"

### 4. Test Authentication

```javascript
// In browser console, check current auth state
fetch('/api/auth/session')
  .then(r => r.json())
  .then(console.log)
```

### 5. Verify room_id

```javascript
// Check what room_id is being used
const url = new URL(window.location);
console.log('Room ID from URL:', url.searchParams.get('room_id'));

// Check WebSocket connection attempt
const wsUrl = `wss://nanotype-db.josh-f96.workers.dev/websocket?room_id=test-room`;
const ws = new WebSocket(wsUrl);
ws.onopen = () => console.log('✅ Connected');
ws.onerror = (e) => console.error('❌ Error:', e);
```

---

## Recommended Fixes

### Fix 1: Validate room_id is Non-Empty

**File:** `src/index.ts` (around line 1361)

```typescript
const roomId = url.searchParams.get("room_id");
if (!roomId || roomId.trim() === '') {
    return new Response(
        JSON.stringify({ error: "room_id parameter is required and must not be empty" }), 
        { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        }
    );
}
```

### Fix 2: Better Error Messages

Add more descriptive errors for debugging:

```typescript
// In src/index.ts - WebSocket upgrade section
if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    try {
        console.log(`WebSocket upgrade request for room: ${roomId}, user: ${session?.user?.id || 'anonymous'}`);
        // ... existing code ...
    } catch (error: any) {
        console.error("WebSocket upgrade failed:", {
            error: error.message,
            roomId,
            userId: session?.user?.id,
            headers: Object.fromEntries(request.headers.entries())
        });
        return new Response(`WebSocket upgrade failed: ${error.message}`, { status: 500 });
    }
}
```

### Fix 3: Client-Side Connection Validation

**File:** `hooks/useDatabase.tsx`

```typescript
const connect = useCallback((nextRoomId: string) => {
    // Validate room_id before attempting connection
    if (!nextRoomId || nextRoomId.trim() === '') {
        addToast('Invalid room ID. Please provide a valid room identifier.', 'error');
        return;
    }
    
    if (currentRoomIdRef.current === nextRoomId && status === 'connected') return;
    
    currentRoomIdRef.current = nextRoomId;
    setStatus('connecting');
    setIsConnected(false);
    setRoomId(nextRoomId);
}, [status]);
```

### Fix 4: Enhanced PartySocket Error Handling

```typescript
const partySocket = useWebSocket(wsUrl, undefined, {
    enabled: Boolean(resolvedRoomId),
    onOpen: () => { /* ... */ },
    onMessage: (event) => { /* ... */ },
    onClose: (event) => {
        wsLog('WebSocket closed:', event.code, event.reason);
        setStatus('disconnected');
        setIsConnected(false);
        
        // Show user-friendly error based on close code
        if (event.code === 1006) {
            addToast('Connection failed. Check your internet connection.', 'error');
        } else if (event.code === 1008) {
            addToast('Connection rejected. Please check your credentials.', 'error');
        } else if (event.reason) {
            addToast(`Connection closed: ${event.reason}`, 'error');
        }
    },
    onError: (error) => {
        wsLog('WebSocket error:', error);
        addToast('WebSocket connection error. Please try again.', 'error');
    }
});
```

### Fix 5: Add Connection Health Check

Add a health check endpoint to verify the Worker is running:

```typescript
// In src/index.ts
if (url.pathname === "/health") {
    return Response.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.0.0"
    });
}
```

---

## Testing Checklist

- [ ] Test with valid room_id: `?room_id=test-room-123`
- [ ] Test with empty room_id: `?room_id=` (should fail with clear error)
- [ ] Test with missing room_id: `?` (should fail with clear error)
- [ ] Test with valid API key in header: `X-Nano-Key: nk_xxx`
- [ ] Test with valid API key in query: `?key=nk_xxx&room_id=test`
- [ ] Test with expired API key (should fail with 401)
- [ ] Test with invalid API key (should fail with 401)
- [ ] Test with valid session cookie (logged in user)
- [ ] Test without authentication (should fail with 401)
- [ ] Test reconnection after network interruption
- [ ] Test multiple tabs connecting to same room
- [ ] Test WebSocket close and reconnect

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  hooks/useDatabase.tsx - PartySocket WebSocket Client           │
│  URL: wss://nanotype-db.josh-f96.workers.dev/websocket?room_id │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ WebSocket Upgrade Request
                           │ Headers: Upgrade, Connection
                           │ Params: room_id, key (optional)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER (Edge Network)                    │
│  src/index.ts - Authentication & Routing                        │
│  1. Extract room_id from query params                           │
│  2. Authenticate (API key OR session cookie OR token)          │
│  3. Set X-User-ID header                                        │
│  4. Forward to Durable Object at /connect                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ Forward Request
                           │ Path: /connect
                           │ Headers: X-User-ID, Upgrade, Connection
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│            DURABLE OBJECT (Persistent State)                     │
│  src/durable-object.ts - NanoStore                              │
│  1. Accept /connect path                                        │
│  2. Verify Upgrade header                                       │
│  3. Create WebSocketPair                                        │
│  4. Call handleSession(server, userId)                         │
│  5. Return 101 Switching Protocols                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ WebSocket Connection Established
                           │ Messages: ping/pong, subscribe, query, rpc
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BIDIRECTIONAL CHANNEL                         │
│  - Client → Server: queries, subscriptions, mutations           │
│  - Server → Client: results, updates, errors                   │
│  - Heartbeat: ping every 30s, pong response                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Files

| File | Purpose |
|------|---------|
| `hooks/useDatabase.tsx` | Client-side WebSocket connection using PartySocket |
| `src/index.ts` | Worker entry point, authentication, routing to DO |
| `src/durable-object.ts` | Durable Object WebSocket handler (/connect endpoint) |
| `vite.config.ts` | Development proxy for WebSocket (`/__ws` → `ws://localhost:8787`) |
| `wrangler.toml` | Cloudflare Worker configuration (Durable Objects binding) |
| `WEBSOCKET_IMPROVEMENTS.md` | Documentation of WebSocket features |

---

## Environment-Specific Behaviors

### Development (localhost)
- Client: `ws://localhost:3000/__ws/websocket?room_id=XXX`
- Vite Proxy: Rewrites to `ws://localhost:8787/websocket?room_id=XXX`
- Worker: Running via `wrangler dev` on port 8787

### Production (Cloudflare)
- Client: `wss://nanotype-db.josh-f96.workers.dev/websocket?room_id=XXX`
- Direct connection to Cloudflare Worker
- Worker: Deployed to Cloudflare global network

---

## Next Steps

1. **Add Enhanced Logging**: Implement structured logging for all WebSocket connection attempts
2. **Monitor Worker Logs**: Check Cloudflare dashboard for real-time errors
3. **Test Authentication**: Verify all auth methods (API key, session, token)
4. **Validate room_id**: Ensure room_id is always provided and non-empty
5. **Check CORS**: Verify cross-origin requests are properly handled
6. **Review Network Tab**: Inspect actual WebSocket handshake in browser DevTools

---

## Conclusion

The error "WebSocket connection to 'wss://nanotype-db.josh-f96.workers.dev/websocket?room_id' failed" indicates that the `room_id` query parameter is present but EMPTY. The most likely causes are:

1. ✅ **Missing/Empty room_id**: Client is not providing a valid room identifier
2. ✅ **Authentication Failure**: User is not authenticated (no valid session, API key, or token)
3. ⚠️ **Network/CORS Issues**: Connection is being blocked by browser or network
4. ⚠️ **Worker Configuration**: Cloudflare Worker may not be deployed or configured correctly

**Immediate Action:** Check browser console and network tab to see the exact error code and message. Then verify authentication status and ensure room_id has a valid value.
