# Durable Object Actor Model Enhancements

This document describes the Actor Model enhancements that make nanotypeDB superior by leveraging Cloudflare Durable Objects' unique capabilities.

## Overview

nanotypeDB now implements three key optimizations that differentiate it from alternatives like Convex:

1. **Hybrid State Management**: In-memory store for transient data
2. **Full SQL Power**: Safe raw SQL interface for complex analytics
3. **Local Aggregation**: Debounced writes to reduce costs

## 1. Hybrid State: Memory Store

### What It Is
The Memory Store is an in-memory key-value store living in the Durable Object's memory. It's perfect for ephemeral data that doesn't need persistence.

### Why It Matters
- **Zero SQLite overhead**: No disk I/O for transient data
- **Automatic expiration**: TTL-based cleanup
- **Instant reads/writes**: No database latency
- **Cost savings**: Reduces billable storage operations

### Use Cases
- **Cursor positions**: Track where users are typing/editing in real-time
- **Presence data**: Show who's online without hitting the database
- **Temporary UI state**: Store ephemeral data like "is user typing..."
- **Cache layer**: Hot data that expires quickly

### API Examples

#### Set Cursor Position
```javascript
// Client-side WebSocket message
ws.send(JSON.stringify({
  action: "rpc",
  method: "setCursor",
  payload: {
    userId: "user123",
    position: { line: 42, column: 10, file: "index.ts" }
  }
}));
```

#### Get All Cursors
```javascript
ws.send(JSON.stringify({
  action: "rpc",
  method: "getCursors"
}));
// Response: [{ userId: "user123", position: {...} }, ...]
```

#### Set Presence
```javascript
ws.send(JSON.stringify({
  action: "rpc",
  method: "setPresence",
  payload: {
    userId: "user123",
    status: { online: true, activity: "editing", lastSeen: Date.now() }
  }
}));
```

#### Get All Presence
```javascript
ws.send(JSON.stringify({
  action: "rpc",
  method: "getPresence"
}));
```

### Features
- **Automatic TTL**: Cursors expire in 30s, presence in 60s
- **Real-time broadcasts**: Updates are pushed to all subscribers
- **Memory efficient**: Automatic cleanup of expired entries

## 2. Full SQL Power: Raw SQL Interface

### What It Is
A controlled raw SQL interface that allows developers to run complex analytics queries while maintaining security.

### Why It Matters
- **Advanced analytics**: Run JOINs, aggregations, window functions
- **Ad-hoc queries**: Explore your data without predefined RPCs
- **Migration tool**: Easy to port existing SQL-based apps
- **Flexibility**: Full power of SQLite when you need it

### Security Features
- **Read-only by default**: Only SELECT and WITH queries allowed
- **Query size limit**: Maximum 10,000 characters
- **No client-side raw SQL**: Disabled for mutation operations
- **Input validation**: Type checking and sanitization

### API Examples

#### Complex Analytics Query
```javascript
ws.send(JSON.stringify({
  action: "rpc",
  method: "executeSQL",
  payload: {
    sql: `
      SELECT 
        status,
        COUNT(*) as count,
        AVG(LENGTH(title)) as avg_title_length
      FROM tasks
      GROUP BY status
      HAVING count > 1
      ORDER BY count DESC
    `,
    readonly: true
  }
}));
```

#### Window Functions
```javascript
ws.send(JSON.stringify({
  action: "rpc",
  method: "executeSQL",
  payload: {
    sql: `
      SELECT 
        title,
        status,
        ROW_NUMBER() OVER (PARTITION BY status ORDER BY id DESC) as rank
      FROM tasks
    `,
    readonly: true
  }
}));
```

#### Common Table Expressions (CTE)
```javascript
ws.send(JSON.stringify({
  action: "rpc",
  method: "executeSQL",
  payload: {
    sql: `
      WITH task_stats AS (
        SELECT status, COUNT(*) as count
        FROM tasks
        GROUP BY status
      )
      SELECT * FROM task_stats WHERE count > 5
    `,
    readonly: true
  }
}));
```

### Limitations
- Read-only mode enforced (no INSERT, UPDATE, DELETE)
- 10,000 character query limit
- Parameters must be embedded as literals (no prepared statements)
- Use caution with user input - validate and sanitize before embedding in queries

## 3. Local Aggregation: Debounced Writes

### What It Is
A write buffer that accumulates high-frequency updates in memory and flushes them to SQLite periodically.

### Why It Matters
- **Cost reduction**: 100 updates/sec → 1 write/sec = 99% cost savings
- **Performance**: Reduces SQLite write contention
- **UI responsiveness**: Accept rapid updates without blocking
- **Better than Convex**: Convex charges per write; we aggregate

### Use Cases
- **Slider UIs**: Position updates while dragging
- **Canvas/drawing apps**: Mouse movement tracking
- **Live counters**: Real-time metrics aggregation
- **Form auto-save**: Buffer keystrokes before persisting

### API Examples

#### High-Frequency Updates (e.g., Slider)
```javascript
// User drags slider - called 60 times per second
sliderElement.addEventListener('input', (e) => {
  ws.send(JSON.stringify({
    action: "rpc",
    method: "updateDebounced",
    payload: {
      key: "slider:brightness",
      value: e.target.value
    }
  }));
  // Only writes to SQLite once per second automatically
});
```

#### Force Immediate Flush
```javascript
// When user stops dragging, force immediate save
sliderElement.addEventListener('change', () => {
  ws.send(JSON.stringify({
    action: "rpc",
    method: "flushDebounced"
  }));
});
```

#### Canvas Drawing Position
```javascript
canvas.addEventListener('mousemove', (e) => {
  ws.send(JSON.stringify({
    action: "rpc",
    method: "updateDebounced",
    payload: {
      key: `cursor:${userId}`,
      value: { x: e.clientX, y: e.clientY, timestamp: Date.now() }
    }
  }));
});
```

### Configuration
- **Default flush interval**: 1000ms (1 second)
- **Auto-flush on idle**: Writes are guaranteed within 1 second of last update
- **Manual flush**: Available via `flushDebounced` RPC
- **Persistent storage**: Stored in `_debounced_state` table after flush
- **Value size limit**: Maximum 100KB per value to prevent memory issues

### Implementation Details
```javascript
// Internal: DebouncedWriter class
// - Buffers writes in a Map
// - Resets timer on each write
// - Flushes to SQLite after interval
// - Prevents write amplification
```

## Comparison with Convex

| Feature | nanotypeDB | Convex |
|---------|------------|--------|
| Transient data | In-memory (free) | Database writes (paid) |
| Raw SQL | Full SQLite power | Limited to their query API |
| High-freq writes | Debounced (1 write/sec) | Every write charged |
| Cursor tracking | Memory Store (instant) | Database operations |
| Presence | Memory Store + TTL | Database + cleanup jobs |
| Cost for 100 updates/sec | 1 SQLite write/sec | 100 writes/sec charged |

## Migration Guide

### From Storing Everything in SQLite

**Before:**
```javascript
// Every cursor move writes to DB
ws.send({
  action: "rpc",
  method: "updateCursor",
  payload: { userId, position } // Writes to SQLite
});
```

**After:**
```javascript
// Cursor moves stay in memory
ws.send({
  action: "rpc",
  method: "setCursor",
  payload: { userId, position } // Memory only
});
```

### From Convex-style Writes

**Convex approach:**
```javascript
// Every slider change = 1 database write
const mutation = api.settings.updateBrightness;
await mutation({ value: sliderValue }); // Billed
```

**nanotypeDB approach:**
```javascript
// Debounced: 60 calls/sec → 1 SQLite write/sec
ws.send({
  action: "rpc",
  method: "updateDebounced",
  payload: { key: "brightness", value: sliderValue }
});
```

## Best Practices

### When to Use Memory Store
✅ **Use for:**
- Cursor positions
- User presence
- "Is typing" indicators
- Real-time collaboration state
- Cache/session data

❌ **Don't use for:**
- Permanent data
- Audit trails
- Data that must survive restarts
- Anything that needs to be queried across DOs

### When to Use Debounced Writes
✅ **Use for:**
- Slider/range inputs
- Mouse position tracking
- Live counters
- Auto-save scenarios
- High-frequency sensor data

❌ **Don't use for:**
- Critical state changes
- Financial transactions
- Data requiring immediate consistency
- Operations that must be logged individually

### When to Use Raw SQL
✅ **Use for:**
- Analytics dashboards
- Complex reports
- Ad-hoc data exploration
- Migration from SQL databases

❌ **Don't use for:**
- Data mutations (use RPCs)
- User input (use validated RPCs)
- High-frequency queries (use RPCs with caching)

## Performance Tips

1. **Combine strategies**: Use memory for cursors + debounced writes for auto-save
2. **Set appropriate TTLs**: Shorter TTLs = less memory usage
3. **Monitor flush frequency**: Adjust debounce interval based on your needs
4. **Use raw SQL sparingly**: Stick to RPCs for common queries

## Security Considerations

1. **Memory Store**: No persistence means no audit trail - use for non-critical data only
2. **Raw SQL**: Read-only mode prevents injection attacks, but limit query complexity
3. **Debounced Writes**: Data in buffer is volatile - ensure flush before critical operations

## Future Enhancements

- [ ] Configurable debounce intervals per key
- [ ] Memory store size limits and LRU eviction
- [ ] Raw SQL query timeouts
- [ ] Analytics on memory store usage
- [ ] Automatic memory cleanup background task
