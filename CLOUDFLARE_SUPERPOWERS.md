# Cloudflare Superpowers Implementation

This document describes the production-grade features added to NanoTypeDB to leverage Cloudflare's infrastructure.

## 🎯 Core Features Implemented

### 1. Cloudflare Queues for AI Embedding Reliability

**Problem**: AI embeddings were lost if Cloudflare AI timed out or rate-limited requests.

**Solution**: Push embedding tasks to Cloudflare Queue with automatic retry logic.

**Implementation**:
- Queue binding: `AI_EMBEDDING_QUEUE` in `wrangler.toml`
- Consumer worker: `src/queue-consumer.ts`
- Retry configuration: 3 max retries with dead letter queue
- Tasks are marked with `vector_status`: 'pending' | 'indexed' | 'failed'

**Usage**:
```typescript
// In createTask RPC method
await env.AI_EMBEDDING_QUEUE.send({
  taskId: newTask.id,
  title: title,
  doId: this.doId,
  timestamp: Date.now()
});
```

### 2. Row Level Security (RLS)

**Problem**: No way to filter data by user - everyone saw everything.

**Solution**: Policy-based access control similar to Postgres RLS.

**Implementation**:
- `RLSPolicyEngine` class with customizable policies
- `owner_id` column added to tasks table (migration v6)
- Automatic filtering in `listTasks` RPC
- Support for custom policies per table

**Usage**:
```typescript
// Register custom policy
rlsEngine.registerPolicy('tasks', (userId, row) => {
  return row.owner_id === userId || row.shared_with?.includes(userId);
});

// Automatic filtering
const tasks = rlsEngine.filterRows('tasks', userId, allTasks);
```

### 3. Analytics Engine for Observability

**Problem**: Usage tracking in SQLite was expensive and hard to query globally.

**Solution**: Push events to Cloudflare Analytics Engine.

**Implementation**:
- Analytics binding: `ANALYTICS` in `wrangler.toml`
- Automatic event tracking in `broadcastUpdate`
- Zero cost, fast queries, global aggregation

**Usage**:
```typescript
// Automatic tracking on every data change
await env.ANALYTICS.writeDataPoint({
  indexes: [table],
  blobs: [action, doId],
  doubles: [1], // Count
});
```

### 4. R2 Integration for File Storage

**Problem**: No story for storing avatars, PDFs, or other files.

**Solution**: Presigned R2 upload URLs with metadata in D1.

**Implementation**:
- File metadata table `_files` (migration v7)
- `getUploadUrl` RPC method
- `listFiles` RPC method with owner filtering

**Usage**:
```javascript
// Client-side
const { fileId, uploadUrl } = await rpc('getUploadUrl', {
  filename: 'avatar.png',
  contentType: 'image/png'
});

// Upload to R2
await fetch(uploadUrl, { method: 'PUT', body: file });

// List files
const files = await rpc('listFiles');
```

### 5. Webhooks for Outbound Events

**Problem**: External systems (Stripe, Slack) need notifications on data changes.

**Solution**: Webhook table with automatic dispatch via Queues.

**Implementation**:
- Webhooks table `_webhooks` (migration v7)
- `registerWebhook` RPC method
- `listWebhooks` RPC method
- Automatic dispatch in `broadcastUpdate` via `WEBHOOK_QUEUE`
- Consumer worker: `src/webhook-consumer.ts`

**Usage**:
```javascript
// Register webhook
await rpc('registerWebhook', {
  url: 'https://example.com/webhook',
  event: 'tasks.added',
  headers: { 'Authorization': 'Bearer token' }
});

// Automatically fires when tasks are created
```

### 6. User-Defined Cron Jobs

**Problem**: Users can't schedule their own RPC calls (e.g., "Daily Email Summary").

**Solution**: Cron jobs table with scheduled RPC execution.

**Implementation**:
- Cron jobs table `_cron_jobs` (migration v7)
- `scheduleCron` RPC method
- `listCronJobs` RPC method
- Per-user ownership via `owner_id`

**Usage**:
```javascript
// Schedule daily summary
await rpc('scheduleCron', {
  name: 'Daily Summary',
  schedule: '0 9 * * *', // 9 AM daily
  rpcMethod: 'generateSummary',
  rpcPayload: { userId: 'user123' }
});
```

### 7. Environment Management

**Problem**: All rooms are production - no dev/staging separation.

**Solution**: Environments table for grouping and promotion.

**Implementation**:
- Environments table `_environments` (migration v7)
- Support for 'dev', 'staging', 'prod' types

**Usage**:
```javascript
// Create environment
await sql.exec(
  "INSERT INTO _environments (id, name, type) VALUES (?, ?, ?)",
  'env_dev', 'Development', 'dev'
);
```

### 8. Enhanced Audit Logs

**Problem**: Console logging doesn't meet enterprise compliance needs.

**Solution**: Structured audit log with CSV export.

**Implementation**:
- Enhanced `_audit_log` table
- `exportAuditLog` RPC method with format support ('json' | 'csv')

**Usage**:
```javascript
// Export as CSV for compliance
const csv = await rpc('exportAuditLog', { format: 'csv' });
// Returns: id,action,payload,timestamp format
```

### 9. AI Gateway for Caching

**Problem**: Hitting raw AI model every time wastes cost and time.

**Solution**: Route AI requests through Cloudflare AI Gateway.

**Implementation**:
- Gateway configuration in `wrangler.toml`: `gateway = "nano-type-ai-gateway"`
- Automatic caching of AI responses
- Rate limiting and logging

**Benefits**:
- Free caching of embeddings
- Reduced AI costs
- Request logs for debugging

### 10. Built-in Optimistic Updates

**Problem**: Manual `performOptimisticAction` requires developers to wire up UI updates.

**Solution**: Automatic optimistic updates with built-in rollback.

**Implementation**:
- New `performMutation` helper in `useDatabase.tsx`
- Pre-defined optimistic logic for common mutations
- Automatic rollback on timeout or error

**Usage**:
```typescript
// Old way - manual optimistic updates
performOptimisticAction(
  'createTask',
  { title: 'New Task' },
  () => { /* manual UI update */ },
  () => { /* manual rollback */ }
);

// New way - automatic optimistic updates
performMutation('createTask', { title: 'New Task' });
// UI updates instantly, rolls back automatically on failure
```

### 11. Automatic Reactivity (Convex-style Live Queries)

**Problem**: Manual `broadcastUpdate` calls in every RPC method. Forgetting it means stale UI.

**Solution**: Queries automatically re-run when their dependent tables change.

**Implementation**:
- New `subscribe_query` and `unsubscribe_query` WebSocket actions
- `querySubscriptions` tracking in NanoStore class  
- Enhanced `broadcastUpdate` to auto-refresh affected queries
- Client helper: `runReactiveQuery` in `useDatabase.tsx`

**Usage**:
```typescript
// Subscribe to a query - it auto-refreshes when 'tasks' table changes
const unsubscribe = runReactiveQuery(
  'listTasks',              // RPC method
  { owner_id: 'user123' },  // Payload
  ['tasks']                 // Dependent tables
);

// When someone creates a task, ALL subscribed queries automatically refresh
performMutation('createTask', { title: 'New Task' });

// Cleanup when component unmounts
useEffect(() => unsubscribe, []);
```

**How It Works**:
1. Client calls `runReactiveQuery(method, payload, tables)`
2. Server stores: `querySubscriptions.set(webSocket, { method, payload, tables })`
3. When data changes via `broadcastUpdate(table, action, row)`:
   - Server finds all queries that depend on `table`
   - Sends `query_refresh` notification to clients
   - Clients can optionally re-fetch data automatically
4. No manual `broadcastUpdate` calls needed - it's automatic!

**Benefits**:
- 🔄 Zero boilerplate - queries just stay fresh
- ⚡ Efficient - only affected queries refresh
- 💯 Convex-style developer experience
- 🎯 Fine-grained - specify exactly which tables to watch

## 🔧 Configuration

### wrangler.toml

```toml
# Queues
[[queues.producers]]
binding = "AI_EMBEDDING_QUEUE"
queue = "ai-embedding-queue"

[[queues.producers]]
binding = "WEBHOOK_QUEUE"
queue = "webhook-queue"

# Analytics Engine
[[analytics_engine_datasets]]
binding = "ANALYTICS"

# AI Gateway
[ai]
binding = "AI"
gateway = "nano-type-ai-gateway"
```

### Database Migrations

All new tables are created in migrations v6 and v7:
- `tasks.owner_id` - RLS support
- `_webhooks` - Webhook registrations
- `_files` - File metadata
- `_cron_jobs` - User-defined schedules
- `_environments` - Environment grouping

## 📊 Feature Comparison

| Feature | Before | After |
|---------|--------|-------|
| AI Reliability | Lost on timeout | Queue with retry |
| Data Access | Everyone sees all | Per-user filtering (RLS) |
| Observability | SQLite writes | Analytics Engine |
| File Storage | None | R2 with presigned URLs |
| External Events | Manual webhooks | Automatic dispatch |
| Cron Jobs | Fixed schedule | User-defined |
| Optimistic UI | Manual wiring | Built-in helper |
| Reactivity | Manual broadcastUpdate | Automatic query refresh |
| AI Costs | Full price | Cached via Gateway |

## 🚀 Migration Guide

### Existing Applications

1. **Update wrangler.toml** with new bindings
2. **Run migrations** to add new tables
3. **Update client code** to use new RPC methods
4. **Optional**: Switch to `performMutation` for easier optimistic updates

### New Applications

All features are available by default. Use the RPC methods as needed:

```javascript
// File upload
await rpc('getUploadUrl', { filename, contentType });

// Webhooks
await rpc('registerWebhook', { url, event });

// Cron jobs
await rpc('scheduleCron', { name, schedule, rpcMethod });

// Audit logs
await rpc('exportAuditLog', { format: 'csv' });
```

## 🔐 Security Considerations

1. **RLS Policies**: Default policy restricts access to owner's data
2. **Rate Limiting**: All RPC methods have per-user rate limits
3. **Input Validation**: All payloads are sanitized
4. **Queue Security**: Internal queue consumers only
5. **Webhook Validation**: Headers support for auth tokens

## 📚 Additional Resources

- [Cloudflare Queues Documentation](https://developers.cloudflare.com/queues/)
- [Analytics Engine Documentation](https://developers.cloudflare.com/analytics/analytics-engine/)
- [AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)

## 🎯 Future Enhancements

- [ ] Cloudflare Workflows for complex migrations
- [ ] Point-in-time recovery with snapshots
- [ ] AST-based TypeScript SDK generator
- [ ] Automatic query re-execution on data changes
- [ ] D1 read replication with region hints
