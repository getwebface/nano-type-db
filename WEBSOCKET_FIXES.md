# WebSocket Connection Fixes

This document contains recommended code changes to fix WebSocket connection issues.

## Problem Statement

Error: `WebSocket connection to 'wss://nanotype-db.josh-f96.workers.dev/websocket?room_id' failed`

The URL shows `room_id` parameter present but without a value (empty string).

---

## Fix 1: Validate Non-Empty room_id in Worker

**File:** `src/index.ts` (Line ~1361)

**Current Code:**
```typescript
const roomId = url.searchParams.get("room_id");
if (!roomId) {
    return new Response("Missing room_id query parameter", { status: 400 });
}
```

**Issue:** This only checks for null/undefined, not empty strings.

**Recommended Fix:**
```typescript
const roomId = url.searchParams.get("room_id");
if (!roomId || roomId.trim() === '') {
    console.error("Invalid room_id attempt:", { 
        roomId, 
        url: url.toString(),
        userId: session?.user?.id 
    });
    return new Response(
        JSON.stringify({ 
            error: "room_id parameter is required and must not be empty",
            hint: "Add ?room_id=your-room-name to the URL"
        }), 
        { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        }
    );
}
```

---

## Fix 2: Better Client-Side Validation

**File:** `hooks/useDatabase.tsx` (Line ~390)

**Current Code:**
```typescript
const connect = useCallback((nextRoomId: string) => {
    if (!nextRoomId) return;
    if (currentRoomIdRef.current === nextRoomId && status === 'connected') return;
    currentRoomIdRef.current = nextRoomId;
    setStatus('connecting');
    setIsConnected(false);
    setRoomId(nextRoomId);
}, [status]);
```

**Issue:** Silent failure when room_id is empty.

**Recommended Fix:**
```typescript
const connect = useCallback((nextRoomId: string) => {
    // Validate room_id before attempting connection
    if (!nextRoomId || nextRoomId.trim() === '') {
        console.error('Connect called with invalid room_id:', nextRoomId);
        addToast('Cannot connect: Invalid or empty room ID', 'error');
        setStatus('disconnected');
        setIsConnected(false);
        return;
    }
    
    if (currentRoomIdRef.current === nextRoomId && status === 'connected') {
        wsLog('Already connected to room:', nextRoomId);
        return;
    }
    
    wsLog('Connecting to room:', nextRoomId);
    currentRoomIdRef.current = nextRoomId;
    setStatus('connecting');
    setIsConnected(false);
    setRoomId(nextRoomId);
}, [status, addToast, wsLog]);
```

---

## Fix 3: Enhanced Error Handling in PartySocket

**File:** `hooks/useDatabase.tsx` (Line ~216)

**Current Code:**
```typescript
onClose: (event) => {
    wsLog('WebSocket closed:', event.code, event.reason);
    setStatus('disconnected');
    setIsConnected(false);
    setConnectionQuality(prev => ({ ...prev, latency: 0 }));
    setReconnectInfo({
        attempt: partySocket.retryCount || 0,
        maxAttempts: 0,
        nextRetryAt: null
    });
},
onError: (error) => {
    wsLog('WebSocket error:', error);
    // Often a 401 will just manifest as a close/error here
}
```

**Issue:** No user feedback on error types.

**Recommended Fix:**
```typescript
onClose: (event) => {
    wsLog('WebSocket closed:', event.code, event.reason);
    setStatus('disconnected');
    setIsConnected(false);
    setConnectionQuality(prev => ({ ...prev, latency: 0 }));
    setReconnectInfo({
        attempt: partySocket.retryCount || 0,
        maxAttempts: 0,
        nextRetryAt: null
    });
    
    // Provide user-friendly error messages based on close code
    // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
    if (event.code === 1006) {
        // Abnormal closure (no close frame)
        addToast('Connection lost unexpectedly. Attempting to reconnect...', 'error');
    } else if (event.code === 1008) {
        // Policy violation (often authentication)
        addToast('Connection rejected. Please check your authentication.', 'error');
    } else if (event.code === 1000) {
        // Normal closure - don't show error
        wsLog('Connection closed normally');
    } else if (event.reason) {
        addToast(`Connection closed: ${event.reason}`, 'error');
    }
},
onError: (error) => {
    wsLog('WebSocket error:', error);
    console.error('WebSocket connection error:', error);
    addToast('Failed to establish WebSocket connection. Please check your network.', 'error');
}
```

---

## Fix 4: Add WebSocket Upgrade Logging

**File:** `src/index.ts` (Line ~1504)

**Current Code:**
```typescript
if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    try {
        const newUrl = new URL(request.url);
        newUrl.pathname = "/connect";
        // ... rest of code
    } catch (error: any) {
        console.error("WebSocket upgrade failed:", error);
        return new Response(`WebSocket upgrade failed: ${error.message}`, { status: 500 });
    }
}
```

**Recommended Fix:**
```typescript
if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    try {
        // Enhanced logging for debugging
        console.log(JSON.stringify({
            level: 'info',
            message: 'WebSocket upgrade request',
            roomId,
            userId: session?.user?.id || 'anonymous',
            isApiKey,
            timestamp: new Date().toISOString()
        }));
        
        const newUrl = new URL(request.url);
        newUrl.pathname = "/connect";
        
        const wsHeaders = new Headers(newHeaders);
        wsHeaders.set("Upgrade", "websocket");
        wsHeaders.set("Connection", "Upgrade");

        const wsRequest = new Request(newUrl.toString(), {
            headers: wsHeaders,
            method: request.method
        });
        
        return stub.fetch(wsRequest);
    } catch (error: any) {
        // Enhanced error logging
        console.error(JSON.stringify({
            level: 'error',
            message: 'WebSocket upgrade failed',
            error: error.message,
            stack: error.stack,
            roomId,
            userId: session?.user?.id,
            timestamp: new Date().toISOString()
        }));
        
        return new Response(
            JSON.stringify({
                error: `WebSocket upgrade failed: ${error.message}`,
                roomId,
                hint: "Check Worker logs for detailed error information"
            }), 
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
```

---

## Fix 5: Add Durable Object Connection Logging

**File:** `src/durable-object.ts` (Line ~1688)

**Current Code:**
```typescript
if (url.pathname === "/connect") {
    const upgradeHeader = request.headers.get("Upgrade");
    console.log("/connect upgrade header:", upgradeHeader);
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        console.error("Invalid Upgrade header for websocket", { upgradeHeader });
        return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const userId = request.headers.get("X-User-ID") || "anonymous";

    try {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

        this.handleSession(server, userId);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    } catch (error: any) {
        console.error("WebSocket upgrade failed:", error);
        return new Response(`WebSocket upgrade failed: ${error.message}`, { status: 500 });
    }
}
```

**Recommended Fix:**
```typescript
if (url.pathname === "/connect") {
    const upgradeHeader = request.headers.get("Upgrade");
    const userId = request.headers.get("X-User-ID") || "anonymous";
    
    // Enhanced logging
    this.logger.info('WebSocket connection attempt', {
        upgradeHeader,
        userId,
        roomId: this.roomId,
        activeConnections: this.ctx.getWebSockets().length
    });
    
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        this.logger.error('Invalid Upgrade header for websocket', { upgradeHeader });
        return new Response(
            JSON.stringify({
                error: "Expected Upgrade: websocket",
                received: upgradeHeader
            }), 
            { 
                status: 426,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }

    try {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

        this.handleSession(server, userId);
        
        this.logger.info('WebSocket connection established', {
            userId,
            roomId: this.roomId,
            totalConnections: this.ctx.getWebSockets().length
        });

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    } catch (error: any) {
        this.logger.error('WebSocket upgrade failed in Durable Object', error, {
            userId,
            roomId: this.roomId
        });
        
        return new Response(
            JSON.stringify({
                error: `WebSocket upgrade failed: ${error.message}`,
                roomId: this.roomId
            }), 
            { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}
```

---

## Fix 6: Add Health Check Endpoint

**File:** `src/index.ts` (Add before main routing)

**New Code to Add:**
```typescript
// Health check endpoint for monitoring
if (url.pathname === "/health") {
    const validation = validateEnvironment(env);
    return Response.json({
        status: validation.valid ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        bindings: {
            DATA_STORE: !!env.DATA_STORE,
            AUTH_DB: !!env.AUTH_DB,
            AI: !!env.AI,
            VECTOR_INDEX: !!env.VECTOR_INDEX,
            EMBEDDING_QUEUE: !!env.EMBEDDING_QUEUE,
            WEBHOOK_QUEUE: !!env.WEBHOOK_QUEUE
        },
        errors: validation.errors
    });
}

// WebSocket connection test endpoint
if (url.pathname === "/ws-test") {
    const roomId = url.searchParams.get("room_id") || "test-room";
    const testUrl = `${url.protocol}//${url.host}/websocket?room_id=${roomId}`;
    
    return Response.json({
        message: "WebSocket endpoint test",
        wsUrl: testUrl,
        upgrade: request.headers.get("Upgrade"),
        instructions: "Use a WebSocket client to connect to the wsUrl above"
    });
}
```

---

## Testing Script

Create a test file to verify WebSocket connections:

**File:** `test-websocket.html`

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Connection Test</title>
</head>
<body>
    <h1>WebSocket Connection Test</h1>
    <div>
        <label>Room ID: <input type="text" id="roomId" value="test-room-123" /></label><br/>
        <label>API Key (optional): <input type="text" id="apiKey" placeholder="nk_..." /></label><br/>
        <button onclick="testConnection()">Connect</button>
        <button onclick="disconnect()">Disconnect</button>
    </div>
    <h2>Status</h2>
    <pre id="status">Not connected</pre>
    <h2>Messages</h2>
    <pre id="messages"></pre>

    <script>
        let ws = null;

        function log(message) {
            const messagesEl = document.getElementById('messages');
            const timestamp = new Date().toISOString();
            messagesEl.textContent += `[${timestamp}] ${message}\n`;
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function updateStatus(status) {
            document.getElementById('status').textContent = status;
        }

        function testConnection() {
            const roomId = document.getElementById('roomId').value;
            const apiKey = document.getElementById('apiKey').value;

            if (!roomId || roomId.trim() === '') {
                alert('Please enter a room ID');
                return;
            }

            // Disconnect existing connection
            if (ws) {
                ws.close();
            }

            // Build WebSocket URL
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            let wsUrl = `${protocol}//${host}/websocket?room_id=${encodeURIComponent(roomId)}`;
            
            if (apiKey) {
                wsUrl += `&key=${encodeURIComponent(apiKey)}`;
            }

            log(`Connecting to: ${wsUrl}`);
            updateStatus('Connecting...');

            try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    log('✅ Connected successfully!');
                    updateStatus('Connected');
                    
                    // Send test message
                    ws.send(JSON.stringify({ action: 'ping' }));
                };

                ws.onmessage = (event) => {
                    log(`📩 Received: ${event.data}`);
                };

                ws.onerror = (error) => {
                    log(`❌ Error: ${error}`);
                    updateStatus('Error');
                    console.error('WebSocket error:', error);
                };

                ws.onclose = (event) => {
                    log(`🔌 Closed: Code=${event.code}, Reason=${event.reason || 'None'}`);
                    updateStatus('Disconnected');
                    
                    // Decode close code
                    const closeReasons = {
                        1000: 'Normal closure',
                        1001: 'Going away',
                        1006: 'Abnormal closure (connection lost)',
                        1008: 'Policy violation',
                        1011: 'Server error'
                    };
                    
                    log(`Close reason: ${closeReasons[event.code] || 'Unknown'}`);
                };
            } catch (error) {
                log(`❌ Exception: ${error.message}`);
                updateStatus('Failed');
                console.error('WebSocket exception:', error);
            }
        }

        function disconnect() {
            if (ws) {
                ws.close(1000, 'User initiated disconnect');
                ws = null;
            }
        }
    </script>
</body>
</html>
```

Save this file and open in browser to test WebSocket connections.

---

## Summary of Changes

| Fix | File | Purpose |
|-----|------|---------|
| 1 | src/index.ts | Validate room_id is not empty |
| 2 | hooks/useDatabase.tsx | Client-side validation and user feedback |
| 3 | hooks/useDatabase.tsx | Better error messages for connection failures |
| 4 | src/index.ts | Enhanced logging for debugging |
| 5 | src/durable-object.ts | Durable Object connection logging |
| 6 | src/index.ts | Health check endpoint for monitoring |

---

## Implementation Priority

1. **High Priority** (Fixes critical issues):
   - Fix 1: Validate non-empty room_id
   - Fix 2: Client-side validation
   - Fix 3: Enhanced error handling

2. **Medium Priority** (Improves debugging):
   - Fix 4: Worker upgrade logging
   - Fix 5: Durable Object logging

3. **Low Priority** (Nice to have):
   - Fix 6: Health check endpoint
   - Testing script

---

## Expected Outcomes

After implementing these fixes:

1. ✅ Users get clear error messages when room_id is missing/empty
2. ✅ Connection failures show specific reasons (auth, network, etc.)
3. ✅ Logs provide detailed debugging information
4. ✅ Health check endpoint allows monitoring Worker status
5. ✅ Test script enables manual WebSocket connection testing

---

## Rollback Plan

If issues occur after deploying fixes:

1. Revert changes to `src/index.ts`
2. Revert changes to `hooks/useDatabase.tsx`
3. Check Cloudflare Worker logs for errors
4. Restore from git: `git revert <commit-hash>`
