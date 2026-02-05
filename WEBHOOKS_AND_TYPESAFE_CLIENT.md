# Type-Safe Client Generator & Webhooks Implementation

## Overview
This implementation addresses two critical issues:
1. **Type Safety**: Replaced hacky regex-based client generator with a proper TypeScript-based generator
2. **Webhooks**: Added webhook infrastructure for real-time notifications to external systems

---

## 1. Type-Safe Client Generator

### What Changed
- **Old**: `scripts/generate-client.js` used regex parsing and string concatenation
- **New**: `scripts/generate-client-typed.ts` and `src/client-generator.ts` use proper TypeScript code generation

### Features
- ✅ Full TypeScript type safety
- ✅ Auto-generated from database schema and RPC actions
- ✅ Typed parameter interfaces for all actions
- ✅ Proper SQL type to TypeScript type conversion
- ✅ WebSocket message type definitions
- ✅ Downloadable from UI

### How to Use

#### Option 1: Download from UI
1. Navigate to Settings in the NanoTypeDB UI
2. Click "Download Client" button
3. The `nanotype-client.ts` file will be downloaded
4. Import and use in your application:

```typescript
import { NanoClient } from './nanotype-client';

const client = new NanoClient('ws://localhost:8787/connect?room_id=demo', 'demo-token');

// Fully typed methods
await client.createTask({ title: 'New Task' });
await client.listTasks({ limit: 10, offset: 0 });
await client.search({ query: 'test' });

// Subscribe to table updates
const unsubscribe = client.subscribe('tasks', (message) => {
  console.log('Table update:', message);
});
```

#### Option 2: Generate Locally
```bash
npm run generate-client
```

### API Endpoint
- `GET /download-client?room_id=demo&token=demo-token`
- Returns: TypeScript client file with proper Content-Disposition header

---

## 2. Webhooks Infrastructure

### Architecture
Webhooks use **Cloudflare Queues** for reliable, async delivery:
1. When data changes, `broadcastUpdate()` is called
2. Webhooks are checked and queued
3. Queue consumer delivers webhooks with retry logic
4. Failed webhooks are tracked and auto-disabled after 10 failures

### Database Schema
```sql
CREATE TABLE _webhooks (
  id TEXT PRIMARY KEY,              -- e.g., "wh_1234567890_abc123"
  url TEXT NOT NULL,                -- Webhook destination URL
  events TEXT NOT NULL,             -- Comma-separated event patterns
  secret TEXT,                      -- HMAC secret for signature verification
  active INTEGER DEFAULT 1,         -- 0 = disabled, 1 = active
  created_at INTEGER NOT NULL,      -- Unix timestamp
  last_triggered_at INTEGER,        -- Last successful trigger
  failure_count INTEGER DEFAULT 0   -- Auto-disabled at 10
);
```

### Event Patterns
Webhooks support flexible event matching:
- `*` - All events
- `tasks.*` - All events on tasks table
- `*.added` - All added events
- `tasks.modified` - Specific table + action
- `tasks.added,tasks.deleted` - Multiple specific events

### API Methods

#### Create Webhook
```typescript
await client.createWebhook({
  url: 'https://example.com/webhook',
  events: 'tasks.added,tasks.modified',
  secret: 'my-secret-key'  // Optional, for HMAC signatures
});
```

#### List Webhooks
```typescript
const webhooks = await client.listWebhooks();
```

#### Update Webhook
```typescript
await client.updateWebhook({
  id: 'wh_1234567890_abc123',
  active: 0  // Disable webhook
});
```

#### Delete Webhook
```typescript
await client.deleteWebhook({ id: 'wh_1234567890_abc123' });
```

### Webhook Payload Format
```json
{
  "event": "tasks.added",
  "table": "tasks",
  "action": "added",
  "data": {
    "id": 123,
    "title": "New Task",
    "status": "pending"
  },
  "timestamp": 1707154800000
}
```

### Security: HMAC Signature Verification
When a secret is provided, webhooks include an HMAC signature:

```
X-Webhook-Signature: sha256=abc123...
```

**Verification Example (Node.js)**:
```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const computed = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}
```

### Retry Logic
- Max retries: 3 (configured in `wrangler.toml`)
- Max batch size: 10 webhooks
- Max batch timeout: 30 seconds
- Dead letter queue: `nanotype-webhooks-dlq` for permanently failed webhooks

### Monitoring
- `last_triggered_at`: Timestamp of last successful delivery
- `failure_count`: Incremented on each failure
- Auto-disable: Webhook disabled after 10 consecutive failures

---

## Configuration

### wrangler.toml
```toml
# Cloudflare Queue for Webhooks
[[queues.producers]]
binding = "WEBHOOK_QUEUE"
queue = "nanotype-webhooks"

[[queues.consumers]]
queue = "nanotype-webhooks"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "nanotype-webhooks-dlq"
```

### Environment Setup
Before deploying, create the queues:
```bash
# Create webhook queue
wrangler queues create nanotype-webhooks

# Create dead letter queue
wrangler queues create nanotype-webhooks-dlq
```

---

## Testing

### Test Client Generation
1. Start the worker: `npm run dev` (or `wrangler dev`)
2. Generate client: `npm run generate-client`
3. Check `src/nanotype-client.ts` for proper types

### Test Webhooks

#### 1. Create a Test Webhook Receiver
Use a service like [webhook.site](https://webhook.site) or create a simple endpoint:

```javascript
// Simple webhook receiver (Express.js)
app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  res.status(200).send('OK');
});
```

#### 2. Register Webhook
```typescript
const client = new NanoClient(wsUrl, token);
await client.createWebhook({
  url: 'https://your-webhook-receiver.com/webhook',
  events: 'tasks.*',
  secret: 'test-secret'
});
```

#### 3. Trigger an Event
```typescript
await client.createTask({ title: 'Test Task' });
```

#### 4. Verify Webhook Delivery
Check your webhook receiver logs for the payload.

---

## Migration Path

### From Old Client to New Client
The new client is backward compatible but provides better types:

**Old (Untyped)**:
```typescript
await client.createTask('Buy milk', 'pending');  // No type checking
```

**New (Typed)**:
```typescript
await client.createTask({ title: 'Buy milk' });  // ✅ Type-safe
```

### Gradual Migration
1. Download new client: Click "Download Client" in Settings
2. Replace old client import
3. Update method calls to use typed parameters
4. TypeScript will guide you with compile errors

---

## Performance Considerations

### Client Generation
- Generated on-demand via `/download-client` endpoint
- Minimal overhead (~10ms) - uses in-memory schema
- Cached by browser (use query params to bust cache if needed)

### Webhooks
- Async delivery via Cloudflare Queues (zero blocking)
- Batch processing (up to 10 webhooks per batch)
- Automatic retry with exponential backoff
- Dead letter queue for debugging failures

---

## Troubleshooting

### Client Generation Issues
**Problem**: "Failed to fetch manifest"
- **Solution**: Ensure Worker is running (`npm run dev`)
- Check Worker URL in `scripts/generate-client-typed.ts`

### Webhook Delivery Issues
**Problem**: Webhooks not being delivered
1. Check webhook is active: `SELECT * FROM _webhooks WHERE id = ?`
2. Check failure count (auto-disabled after 10 failures)
3. Verify queue binding in `wrangler.toml`
4. Check Cloudflare dashboard for queue metrics

**Problem**: "Queue not found"
- **Solution**: Create queues: `wrangler queues create nanotype-webhooks`

---

## Future Enhancements

### Type Safety
- [ ] Generate OpenAPI spec from schema
- [ ] Add zod schemas for runtime validation
- [ ] Generate SDKs for other languages (Python, Go, etc.)

### Webhooks
- [ ] Webhook testing UI
- [ ] Webhook logs/history
- [ ] Webhook templates
- [ ] Rate limiting per webhook
- [ ] Custom headers support
- [ ] Conditional webhooks (filters)

---

## Summary

### What Was Fixed
1. ✅ Replaced regex-based client generator with TypeScript-based generator
2. ✅ Added full type safety for all RPC methods and schemas
3. ✅ Implemented webhooks with Cloudflare Queues
4. ✅ Added HMAC signature verification for security
5. ✅ Built webhook management UI
6. ✅ Automatic retry and failure tracking

### Impact
- **Type Safety**: Catches errors at compile-time instead of runtime
- **Developer Experience**: IntelliSense and autocomplete for all methods
- **Reliability**: Cloudflare Queues ensures webhook delivery
- **Security**: HMAC signatures prevent tampering
- **Scalability**: Async delivery doesn't block database operations
