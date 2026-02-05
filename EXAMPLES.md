# Actor Model Usage Examples

This directory contains examples demonstrating the Actor Model enhancements.

## Quick Start Examples

### Example 1: Collaborative Cursor Tracking

```javascript
// In your React component or client code
import { useEffect, useState } from 'react';

function CollaborativeEditor() {
  const [cursors, setCursors] = useState([]);
  const ws = useWebSocket(); // Your WebSocket connection
  
  // Listen for cursor updates from other users
  useEffect(() => {
    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.event === 'memory_update' && data.type === 'cursors') {
        // Real-time cursor update from another user
        setCursors(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(c => c.userId === data.data.userId);
          if (idx >= 0) {
            updated[idx] = data.data;
          } else {
            updated.push(data.data);
          }
          return updated;
        });
      }
    };
    
    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
  
  // Send cursor position when user moves cursor
  const handleCursorMove = (e) => {
    const position = {
      line: getCurrentLine(e),
      column: getCurrentColumn(e),
      file: 'app.tsx'
    };
    
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'setCursor',
      payload: {
        userId: currentUser.id,
        position
      }
    }));
  };
  
  return (
    <div onMouseMove={handleCursorMove}>
      {/* Render other users' cursors */}
      {cursors.map(cursor => (
        <Cursor key={cursor.userId} position={cursor.position} />
      ))}
      {/* Your editor content */}
    </div>
  );
}
```

### Example 2: Presence System

```javascript
function PresenceIndicator() {
  const [activeUsers, setActiveUsers] = useState([]);
  const ws = useWebSocket();
  
  useEffect(() => {
    // Set our presence on mount
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'setPresence',
      payload: {
        userId: currentUser.id,
        status: {
          online: true,
          activity: 'viewing',
          lastSeen: Date.now()
        }
      }
    }));
    
    // Update presence periodically (heartbeat)
    const interval = setInterval(() => {
      ws.send(JSON.stringify({
        action: 'rpc',
        method: 'setPresence',
        payload: {
          userId: currentUser.id,
          status: {
            online: true,
            activity: getCurrentActivity(),
            lastSeen: Date.now()
          }
        }
      }));
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, [ws]);
  
  // Listen for presence updates
  useEffect(() => {
    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.event === 'memory_update' && data.type === 'presence') {
        setActiveUsers(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(u => u.userId === data.data.userId);
          if (idx >= 0) {
            updated[idx] = data.data;
          } else {
            updated.push(data.data);
          }
          return updated;
        });
      }
    };
    
    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
  
  return (
    <div className="presence-bar">
      {activeUsers.map(user => (
        <Avatar key={user.userId} user={user} status={user.status} />
      ))}
    </div>
  );
}
```

### Example 3: Slider with Debounced Persistence

```javascript
function BrightnessSlider() {
  const [brightness, setBrightness] = useState(50);
  const ws = useWebSocket();
  
  // Handle slider drag (high frequency - debounced)
  const handleInput = (e) => {
    const value = parseInt(e.target.value);
    setBrightness(value); // Update UI immediately
    
    // Send to server (will be debounced)
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'updateDebounced',
      payload: {
        key: `settings:brightness:${currentUser.id}`,
        value: value
      }
    }));
  };
  
  // Force save when user finishes dragging
  const handleChange = () => {
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'flushDebounced'
    }));
  };
  
  return (
    <div>
      <label>Brightness: {brightness}</label>
      <input
        type="range"
        min="0"
        max="100"
        value={brightness}
        onInput={handleInput}  // Fires ~60 times/sec while dragging
        onChange={handleChange} // Fires once when released
      />
      <p className="hint">
        Dragging sends 60 updates/sec, but only 1 write/sec to SQLite!
      </p>
    </div>
  );
}
```

### Example 4: Analytics Dashboard with Raw SQL

```javascript
function AnalyticsDashboard() {
  const [stats, setStats] = useState(null);
  const ws = useWebSocket();
  
  const loadAnalytics = async () => {
    // Complex aggregation query using raw SQL
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'executeSQL',
      payload: {
        sql: `
          SELECT 
            status,
            COUNT(*) as total,
            AVG(LENGTH(title)) as avg_title_length,
            MIN(id) as first_task_id,
            MAX(id) as last_task_id
          FROM tasks
          GROUP BY status
          ORDER BY total DESC
        `,
        readonly: true
      }
    }));
  };
  
  useEffect(() => {
    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'query_result' && data.originalSql.includes('GROUP BY status')) {
        setStats(data.data);
      }
    };
    
    ws.addEventListener('message', handleMessage);
    loadAnalytics();
    
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
  
  return (
    <div className="analytics">
      <h2>Task Analytics</h2>
      {stats && (
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Total</th>
              <th>Avg Title Length</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(row => (
              <tr key={row.status}>
                <td>{row.status}</td>
                <td>{row.total}</td>
                <td>{row.avg_title_length.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

### Example 5: Real-time Canvas Drawing

```javascript
function CollaborativeCanvas() {
  const canvasRef = useRef(null);
  const ws = useWebSocket();
  const [remoteDrawings, setRemoteDrawings] = useState([]);
  
  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Draw locally (immediate feedback)
    drawPoint(x, y);
    
    // Send position (debounced to reduce network traffic)
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'updateDebounced',
      payload: {
        key: `drawing:${currentUser.id}:position`,
        value: { x, y, timestamp: Date.now(), color: currentColor }
      }
    }));
  };
  
  const handleMouseUp = () => {
    // Flush final position immediately
    ws.send(JSON.stringify({
      action: 'rpc',
      method: 'flushDebounced'
    }));
  };
  
  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      width={800}
      height={600}
    />
  );
}
```

## Best Practices

### 1. Memory Store TTL Selection

```javascript
// Cursors: 30 seconds (frequent updates expected)
ws.send({ method: 'setCursor', ... }); // TTL: 30s

// Presence: 60 seconds (less frequent updates)
ws.send({ method: 'setPresence', ... }); // TTL: 60s

// Custom TTL: Adjust based on your needs
// - Short TTL (10-30s): High-frequency updates
// - Medium TTL (60-120s): Moderate updates
// - Long TTL (5-10min): Infrequent updates
```

### 2. Debounced Write Timing

```javascript
// Fast UI (sliders, color pickers): onInput + onChange
<input 
  onInput={handleDebounced}  // Every change
  onChange={handleFlush}      // Final value
/>

// Auto-save forms: Just debounced
<textarea onChange={handleDebounced} />
// Will auto-flush after 1 second of inactivity

// Critical operations: Immediate flush
saveButton.onClick(() => {
  ws.send({ method: 'flushDebounced' });
  // Then proceed with critical operation
});
```

### 3. SQL Query Optimization

```javascript
// ✅ Good: Specific, indexed queries
executeSQL({
  sql: 'SELECT * FROM tasks WHERE status = ? ORDER BY id DESC LIMIT 10'
});

// ✅ Good: Aggregations on small tables
executeSQL({
  sql: 'SELECT status, COUNT(*) FROM tasks GROUP BY status'
});

// ❌ Avoid: Full table scans on large tables
executeSQL({
  sql: 'SELECT * FROM tasks' // Could be huge!
});

// ❌ Avoid: Complex joins (use RPCs instead)
executeSQL({
  sql: 'SELECT t1.*, t2.* FROM tasks t1 JOIN ... LEFT JOIN ...'
});
```

## Performance Comparisons

### Cursor Updates: nanotypeDB vs Convex

```javascript
// Convex approach (charged per write)
// 60 cursor moves/sec = 60 database writes/sec
for (let i = 0; i < 60; i++) {
  await convex.mutation(api.cursors.update, { position });
  // Cost: 60 writes × $0.001 = $0.06/sec
}

// nanotypeDB approach (memory only)
// 60 cursor updates/sec = 0 database writes
for (let i = 0; i < 60; i++) {
  ws.send({ method: 'setCursor', payload: { position } });
  // Cost: $0 (in-memory)
}
```

### Slider Updates: nanotypeDB vs Convex

```javascript
// Convex approach
// User drags slider for 5 seconds = 300 writes
slider.addEventListener('input', async (e) => {
  await convex.mutation(api.settings.update, { value: e.target.value });
  // Cost: 300 writes
});

// nanotypeDB approach
// User drags slider for 5 seconds = 5 writes (1/sec)
slider.addEventListener('input', (e) => {
  ws.send({ method: 'updateDebounced', payload: { value: e.target.value } });
  // Cost: 5 writes (99% reduction!)
});
```

## Migration from Traditional Approach

### Before: Everything in SQLite
```javascript
// Every operation hits the database
updateCursor(position)   → SQLite write
setPresence(status)      → SQLite write  
updateSlider(value)      → SQLite write (×60/sec)

// Result: High latency, high cost
```

### After: Hybrid State Model
```javascript
// Transient data in memory
updateCursor(position)   → Memory (instant, free)
setPresence(status)      → Memory (instant, free)

// Debounced persistence
updateSlider(value)      → Buffer → SQLite (1/sec)

// Result: Low latency, low cost
```

## Troubleshooting

### Memory Store Not Working
- Check WebSocket connection is open
- Verify userId is being sent correctly
- Check browser console for errors
- Memory expires after TTL - refresh presence regularly

### Debounced Writes Not Persisting
- Ensure flush interval has passed (1 second)
- Call `flushDebounced` manually for immediate save
- Check SQLite `_debounced_state` table
- Verify no errors in server logs

### Raw SQL Queries Blocked
- Ensure `readonly: true` is set
- Only SELECT and WITH queries allowed
- Check query length (max 10,000 chars)
- Avoid internal tables (prefixed with `_`)

## Next Steps

1. Implement cursor tracking in your app
2. Add presence indicators
3. Use debounced writes for sliders/forms
4. Build analytics dashboards with raw SQL
5. Monitor performance improvements

For more details, see [ACTOR_MODEL.md](../ACTOR_MODEL.md)
