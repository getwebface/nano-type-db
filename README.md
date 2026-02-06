<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Z_rvYIuwSty1XkzeKDuY_vanU1VE93QC

## 🔧 Quick Start & Database Setup

**IMPORTANT:** Before running the app, ensure your databases are properly initialized.

### Fix Database Issues

If you encounter **"no such table: api_keys"** or other database errors:

**Local Development:**
```bash
npm install
npm run db:fix:local
npm run dev
```

**Production:**
```bash
npm run db:fix:remote  # Requires CLOUDFLARE_API_TOKEN
```

For detailed migration documentation, see [PRODUCTION_MIGRATIONS_GUIDE.md](./PRODUCTION_MIGRATIONS_GUIDE.md).

### Common Database Commands

```bash
npm run migrate:status          # Check migration status
npm run migrate:up -- --local   # Apply migrations (local)
npm run migrate:up -- --remote  # Apply migrations (production)
npm run db:fix:local            # Auto-fix local database
npm run db:fix:remote           # Auto-fix production database
```

## Features

- **Real-time Database**: Powered by Cloudflare Durable Objects with WebSocket support
- **Automatic Reconnection**: Smart reconnection logic with exponential backoff
- **Connection Health Monitoring**: Heartbeat/ping-pong to keep connections alive
- **Visual Status Indicators**: Real-time connection status display
- **Better Auth Integration**: Secure authentication with Better Auth

### 🔥 NEW: Automatic Reactivity (Convex-style Live Queries)

**Write a standard query. Data changes? Query auto-refreshes. Zero manual work.**

Previously, you had to manually call `broadcastUpdate` in every RPC method. Now, queries automatically re-run when their dependent tables change.

```javascript
// Automatic reactivity - query re-runs when tasks table changes
const unsubscribe = runReactiveQuery('listTasks', {}, ['tasks']);

// Create a new task - ALL subscribed queries automatically refresh
performMutation('createTask', { title: 'New Task' });
// UI updates instantly (optimistic), query auto-refreshes with real data

// Cleanup when component unmounts
useEffect(() => unsubscribe, []);
```

**Key Benefits:**
- 🔄 **Automatic Refresh**: Queries re-run when data changes
- ⚡ **Zero Boilerplate**: No manual `broadcastUpdate` needed
- 💯 **Type-Safe**: Full TypeScript support
- 🎯 **Selective**: Only re-runs queries that depend on changed tables
- 🚀 **Efficient**: Debounced updates prevent query spam

See [CLOUDFLARE_SUPERPOWERS.md](./CLOUDFLARE_SUPERPOWERS.md) for full documentation.

### ⚡ NEW: Semantic Reflex (Killer Feature #1)

**Push data based on meaning, not just ID.** Subscribe to events using natural language descriptions and get instant notifications when new content matches semantically.

```javascript
// Subscribe to "Angry Customers" with natural language
subscribeSemantic({
  topic: "angry_customers",
  description: "Customers who are frustrated, upset, or complaining about poor service",
  threshold: 0.7
})

// Automatically receive notifications when matching tasks are created
// No polling, no queries - instant semantic matching in RAM
```

**Key Benefits:**
- 🎯 **Semantic Matching**: AI-powered similarity detection
- ⚡ **Instant Alerts**: Millisecond latency, no database queries
- 💰 **Zero Cost**: Runs in RAM, not database
- 🚀 **Real-time**: WebSocket notifications as events happen

See [SEMANTIC_REFLEX.md](./SEMANTIC_REFLEX.md) for full documentation and examples.

### 🚀 NEW: Actor Model Enhancements

nanotypeDB now implements the Durable Object Actor Model for superior performance:

- **🧠 Hybrid State Management**: In-memory store for transient data (cursors, presence) - bypasses SQLite for instant updates
- **💪 Full SQL Power**: Safe raw SQL interface for complex analytics and aggregations
- **⚡ Local Aggregation**: Debounced writes reduce high-frequency updates (100/sec → 1/sec), cutting costs by 99%
- **🚀 Horizontal Read Scaling**: D1 read replicas enable distributed reads while maintaining write consistency

**Why it's superior to Convex:**
- Memory Store: Free transient data storage vs. charged database writes
- Raw SQL: Full SQLite power vs. limited query API
- Debouncing: 1 write/sec vs. charged per write
- **Horizontal Scaling**: D1 read replicas scale infinitely vs. Convex's single-point bottlenecks

See [ACTOR_MODEL.md](./ACTOR_MODEL.md) for full documentation and [EXAMPLES.md](./EXAMPLES.md) for usage examples.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## WebSocket Connection

For details on the WebSocket connection system and troubleshooting, see [WEBSOCKET_IMPROVEMENTS.md](./WEBSOCKET_IMPROVEMENTS.md).
