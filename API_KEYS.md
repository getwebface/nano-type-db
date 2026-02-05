# API Keys - Developer Documentation

## Overview

API Keys allow you to authenticate your applications with nanotypeDB without requiring your end users to log into the dashboard. This transforms nanotypeDB from a development tool into a production-ready database platform.

## Getting Started

### 1. Generate an API Key

1. Log into your nanotypeDB dashboard
2. Click the room you want to connect to
3. Navigate to **Settings** in the left sidebar
4. Click **"New Key"** under API Keys
5. Give your key a descriptive name (e.g., "Production Website", "Mobile App")
6. Copy the generated key - it will look like: `nk_live_8f92a3b4c5d6e7f8g9h0i1j2k3l4m5n6`

### 2. Use the API Key in Your Application

#### React/TypeScript

```tsx
import { DatabaseProvider } from 'nanotypedb-react';

function App() {
  return (
    <DatabaseProvider 
      apiKey="nk_live_8f92a3b4c5d6e7f8g9h0i1j2k3l4m5n6"
      psychic={false}
    >
      <YourApp />
    </DatabaseProvider>
  );
}
```

#### JavaScript (Direct WebSocket Connection)

```javascript
const apiKey = 'nk_live_8f92a3b4c5d6e7f8g9h0i1j2k3l4m5n6';
const roomId = 'my-production-db';
const wsUrl = `wss://nanotype-db.your-worker.workers.dev/?room_id=${roomId}&api_key=${apiKey}`;

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  console.log('Connected to nanotypeDB');
  
  // Send queries via WebSocket
  ws.send(JSON.stringify({
    action: 'rpc',
    method: 'listTasks'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

#### Using with HTTP Header

You can also pass the API key via the `X-Nano-Key` header:

```javascript
const response = await fetch('https://nanotype-db.your-worker.workers.dev/schema?room_id=my-room', {
  headers: {
    'X-Nano-Key': 'nk_live_8f92a3b4c5d6e7f8g9h0i1j2k3l4m5n6'
  }
});
```

## Security Best Practices

1. **Never commit API keys to source control**
   - Use environment variables: `process.env.NANO_API_KEY`
   - Add `.env` files to `.gitignore`

2. **Use different keys for different environments**
   - Create separate keys for development, staging, and production
   - This allows you to rotate keys without affecting all environments

3. **Rotate keys regularly**
   - Delete old keys that are no longer in use
   - Generate new keys if you suspect a key has been compromised

4. **Monitor key usage**
   - The dashboard shows when each key was last used
   - Regularly review and delete unused keys

## Key Format

API keys follow this format:
- Prefix: `nk_live_` (indicates a live/production key)
- Random string: 32 hexadecimal characters
- Full example: `nk_live_8f92a3b4c5d6e7f8g9h0i1j2k3l4m5n6`

## Authentication Priority

When multiple authentication methods are provided, the system checks them in this order:

1. **API Key** (via `X-Nano-Key` header or `api_key` query parameter)
2. **Session Cookie** (for dashboard users)
3. **Session Token** (via `session_token` query parameter)

## Permissions

Currently, all API keys have `read,write` permissions by default. Future versions may support granular permissions.

## Troubleshooting

### "Unauthorized: Invalid API Key or Session"

This error means your API key is invalid or has been deleted. Check:
- The key is correctly copied (no extra spaces)
- The key still exists in your dashboard under Settings → API Keys
- The key hasn't been deleted

### Connection Timeout

If the WebSocket connection times out:
- Verify the Worker URL is correct
- Check that the room_id exists
- Ensure your API key is valid

### CORS Issues

If you're using API keys from a web browser, ensure CORS is properly configured on the Worker.

## Example: Full React Integration

```tsx
import React from 'react';
import { DatabaseProvider, useDatabase } from 'nanotypedb-react';

// Your app component
function TaskList() {
  const { connect, runQuery, data } = useDatabase();
  
  React.useEffect(() => {
    connect('my-tasks-room');
  }, []);
  
  return (
    <div>
      <h1>My Tasks</h1>
      {/* Your task list UI */}
    </div>
  );
}

// Main app with API key authentication
function App() {
  return (
    <DatabaseProvider 
      apiKey={process.env.REACT_APP_NANO_API_KEY}
    >
      <TaskList />
    </DatabaseProvider>
  );
}

export default App;
```

## Environment Variables Setup

### Create `.env.local` (for React/Vite)
```bash
REACT_APP_NANO_API_KEY=nk_live_8f92a3b4c5d6e7f8g9h0i1j2k3l4m5n6
```

### Add to `.gitignore`
```
.env
.env.local
.env.*.local
```

---

**Need Help?** Visit the [nanotypeDB documentation](https://github.com/getwebface/nano-type-db) or open an issue.
