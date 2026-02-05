# NanoTypeDB Usage Examples

Complete examples showing all Cloudflare Superpowers features.

## 1. Automatic Reactivity (Live Queries)

### Basic Usage

```typescript
import { useDatabase } from './hooks/useDatabase';
import { useEffect } from 'react';

function TaskList() {
  const { runReactiveQuery, lastResult } = useDatabase();
  
  useEffect(() => {
    // Subscribe to listTasks - automatically refreshes when tasks change
    const unsubscribe = runReactiveQuery(
      'listTasks',
      { limit: 50 },
      ['tasks']  // Watch 'tasks' table
    );
    
    return unsubscribe; // Cleanup on unmount
  }, [runReactiveQuery]);
  
  return (
    <div>
      {lastResult?.data.map(task => (
        <div key={task.id}>{task.title}</div>
      ))}
    </div>
  );
}
```

### With Row-Level Security

```typescript
function MyTasks({ userId }) {
  const { runReactiveQuery, lastResult } = useDatabase();
  
  useEffect(() => {
    // Only show tasks owned by this user (RLS filtering)
    const unsubscribe = runReactiveQuery(
      'listTasks',
      { owner_id: userId },
      ['tasks']
    );
    
    return unsubscribe;
  }, [runReactiveQuery, userId]);
  
  // UI automatically updates when tasks change!
  return <TaskList tasks={lastResult?.data || []} />;
}
```

## 2. Built-in Optimistic Updates

### Before (Manual)

```typescript
// Old way - lots of boilerplate
function createTask(title: string) {
  const tempId = `temp_${Date.now()}`;
  const tempTask = { id: tempId, title, status: 'pending' };
  
  performOptimisticAction(
    'createTask',
    { title },
    // Optimistic update
    () => setTasks(prev => [...prev, tempTask]),
    // Rollback
    () => setTasks(prev => prev.filter(t => t.id !== tempId))
  );
}
```

### After (Automatic)

```typescript
// New way - one line!
function createTask(title: string) {
  performMutation('createTask', { title });
  // UI updates instantly, rolls back on error
}
```

## 3. Row-Level Security (RLS)

### Define Custom Policy

```typescript
// Server-side (durable-object.ts)
rlsEngine.registerPolicy('tasks', (userId, row) => {
  // User can see their own tasks or shared tasks
  return row.owner_id === userId || row.shared_with?.includes(userId);
});
```

### Use in Client

```typescript
// All queries automatically respect RLS
const tasks = await rpc('listTasks', { owner_id: currentUserId });
// Only returns tasks this user can access
```

## 4. File Storage with R2

### Upload File

```typescript
async function uploadAvatar(file: File) {
  // Step 1: Get presigned upload URL
  const { fileId, uploadUrl } = await rpc('getUploadUrl', {
    filename: file.name,
    contentType: file.type
  });
  
  // Step 2: Upload directly to R2
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file
  });
  
  console.log(`File uploaded: ${fileId}`);
}
```

### List Files

```typescript
async function listMyFiles() {
  const files = await rpc('listFiles');
  
  files.forEach(file => {
    console.log(`${file.filename} - ${file.size} bytes`);
  });
}
```

## 5. Webhooks for External Integration

### Register Webhook

```typescript
// Send notification to Slack when tasks are created
await rpc('registerWebhook', {
  url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
  event: 'tasks.added',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Now, when someone creates a task, Slack gets notified automatically!
```

### Webhook Payload

```json
{
  "event": "tasks.added",
  "data": {
    "id": 123,
    "title": "New Task",
    "status": "pending",
    "owner_id": "user_abc"
  },
  "timestamp": "2024-02-05T10:30:00Z"
}
```

## 6. User-Defined Cron Jobs

### Schedule Daily Summary

```typescript
await rpc('scheduleCron', {
  name: 'Daily Task Summary',
  schedule: '0 9 * * *', // 9 AM daily
  rpcMethod: 'generateSummary',
  rpcPayload: {
    userId: 'user_123',
    format: 'email'
  }
});
```

### List Scheduled Jobs

```typescript
const jobs = await rpc('listCronJobs');

jobs.forEach(job => {
  console.log(`${job.name}: ${job.schedule}`);
});
```

## 7. Audit Log Export

### Export as JSON

```typescript
const logs = await rpc('exportAuditLog', { format: 'json' });

logs.forEach(log => {
  console.log(`${log.timestamp}: ${log.action}`);
});
```

### Export as CSV for Compliance

```typescript
const csv = await rpc('exportAuditLog', { format: 'csv' });

// Download as file
const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'audit-log.csv';
a.click();
```

## 8. Complete Example: Task Manager with All Features

```typescript
import { useDatabase } from './hooks/useDatabase';
import { useEffect, useState } from 'react';

function TaskManager({ userId }) {
  const { 
    runReactiveQuery, 
    performMutation, 
    lastResult 
  } = useDatabase();
  
  const [newTaskTitle, setNewTaskTitle] = useState('');
  
  // Automatic reactivity - query refreshes when data changes
  useEffect(() => {
    const unsubscribe = runReactiveQuery(
      'listTasks',
      { owner_id: userId }, // RLS filtering
      ['tasks']
    );
    
    return unsubscribe;
  }, [runReactiveQuery, userId]);
  
  // Built-in optimistic update
  const handleCreate = () => {
    performMutation('createTask', {
      title: newTaskTitle,
      owner_id: userId
    });
    setNewTaskTitle('');
    // UI updates instantly, query auto-refreshes with real data
  };
  
  const handleComplete = (taskId: number) => {
    performMutation('completeTask', { id: taskId });
    // UI updates instantly, query auto-refreshes
  };
  
  const handleDelete = (taskId: number) => {
    performMutation('deleteTask', { id: taskId });
    // UI updates instantly, query auto-refreshes
  };
  
  return (
    <div>
      <input
        value={newTaskTitle}
        onChange={e => setNewTaskTitle(e.target.value)}
        placeholder="New task..."
      />
      <button onClick={handleCreate}>Add Task</button>
      
      <ul>
        {lastResult?.data.map(task => (
          <li key={task.id}>
            <span>{task.title}</span>
            {task.status !== 'completed' && (
              <button onClick={() => handleComplete(task.id)}>
                Complete
              </button>
            )}
            <button onClick={() => handleDelete(task.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## 9. Analytics Dashboard

```typescript
// Analytics Engine tracks all data changes automatically
// Query your usage data with Cloudflare GraphQL

query {
  viewer {
    accounts(filter: { accountTag: "YOUR_ACCOUNT_ID" }) {
      nanotypeDatabaseEvents: analyticsDatasets(filter: { name: "ANALYTICS" }) {
        dimensions {
          table
          action
        }
        sum {
          count
        }
      }
    }
  }
}
```

## 10. AI Embeddings with Queue Reliability

```typescript
// Before: Embeddings lost on timeout
// After: Queued for retry

// This happens automatically in createTask:
await env.AI_EMBEDDING_QUEUE.send({
  taskId: newTask.id,
  title: title,
  doId: this.doId,
  timestamp: Date.now()
});

// Queue consumer retries up to 3 times
// Failed messages go to dead letter queue for inspection
```

## Best Practices

### 1. Use Reactive Queries for Lists

```typescript
// ✅ Good - live updates
useEffect(() => {
  const unsub = runReactiveQuery('listTasks', {}, ['tasks']);
  return unsub;
}, []);

// ❌ Bad - manual refresh needed
useEffect(() => {
  rpc('listTasks', {});
}, []);
```

### 2. Use Built-in Optimistic Updates

```typescript
// ✅ Good - instant UI updates
performMutation('createTask', { title });

// ❌ Bad - manual optimistic logic
performOptimisticAction('createTask', { title }, optimistic, rollback);
```

### 3. Enable RLS for Multi-Tenant Apps

```typescript
// ✅ Good - enforce data isolation
rpc('listTasks', { owner_id: currentUser.id });

// ❌ Bad - returns everyone's data
rpc('listTasks', {});
```

### 4. Use Webhooks for External Systems

```typescript
// ✅ Good - automatic notifications
await rpc('registerWebhook', {
  url: 'https://api.stripe.com/webhook',
  event: 'tasks.completed'
});

// ❌ Bad - manual polling
setInterval(async () => {
  const tasks = await rpc('listTasks', { status: 'completed' });
  // Send to Stripe...
}, 60000);
```

## Performance Tips

1. **Batch Operations**: Group multiple mutations together
2. **Selective Tables**: Only watch tables you actually need
3. **Pagination**: Use `limit` and `offset` for large datasets
4. **RLS Filtering**: Always filter by `owner_id` to reduce query size
5. **Unsubscribe**: Always cleanup subscriptions on unmount

## Troubleshooting

### Query Not Refreshing?

```typescript
// Make sure you're watching the right tables
runReactiveQuery('listTasks', {}, ['tasks']); // ✅
runReactiveQuery('listTasks', {}, ['users']); // ❌ Wrong table!
```

### Optimistic Update Not Rolling Back?

```typescript
// Check WebSocket connection
if (!socket || socket.readyState !== WebSocket.OPEN) {
  console.error('Not connected!');
}
```

### RLS Not Filtering?

```typescript
// Check that owner_id is set on tasks
await rpc('createTask', {
  title: 'Task',
  owner_id: userId // Must provide owner_id!
});
```

## Next Steps

- Read [CLOUDFLARE_SUPERPOWERS.md](./CLOUDFLARE_SUPERPOWERS.md) for architecture details
- Check [wrangler.toml](./wrangler.toml) for configuration
- Explore [src/durable-object.ts](./src/durable-object.ts) for server-side code
- Review [hooks/useDatabase.tsx](./hooks/useDatabase.tsx) for client-side API
