# Deployment Guide: Sync Engine Setup

This guide walks you through deploying nanotypeDB with the Sync Engine for unlimited read scaling.

## Overview

The Sync Engine automatically replicates data from Durable Objects to Cloudflare D1, enabling:
- ✅ **Unlimited read throughput** (D1 is distributed globally)
- ✅ **Strong write consistency** (DO provides ACID guarantees)
- ✅ **Automatic failover** (falls back to DO if D1 unavailable)
- ✅ **Zero code changes** (works transparently)

## Prerequisites

1. **Cloudflare Account**: Sign up at https://cloudflare.com
2. **Wrangler CLI**: Install with `npm install -g wrangler`
3. **Authentication**: Run `wrangler login`

## Step-by-Step Deployment

### Step 1: Create D1 Database

```bash
# Create the D1 read replica database
wrangler d1 create nanotype-read-replica
```

**Output:**
```
✅ Successfully created DB 'nanotype-read-replica' in region WNAM
Created your database using D1's new storage backend.

[[d1_databases]]
binding = "DB"
database_name = "nanotype-read-replica"
database_id = "abc123-your-database-id-here"
```

**Copy the `database_id`** - you'll need it in the next step!

### Step 2: Update Configuration

Edit `wrangler.toml` and replace the placeholder database ID:

```toml
# Find this section in wrangler.toml
[[d1_databases]]
binding = "READ_REPLICA"
database_name = "nanotype-read-replica"
database_id = "abc123-your-database-id-here"  # ← Replace with your actual ID
```

### Step 3: Run Database Migration

Apply the schema to your D1 database:

```bash
# For production
wrangler d1 execute nanotype-read-replica --file=./migrations/0001_read_replica_schema.sql

# For local development
wrangler d1 execute nanotype-read-replica --local --file=./migrations/0001_read_replica_schema.sql
```

**Expected output:**
```
🌀 Executing on remote database nanotype-read-replica (abc123...):
🌀 To execute on your local development database, remove the --remote flag
├ 🚣 Executed 4 commands in 0.234ms
```

### Step 4: Verify Schema

Check that the tables were created:

```bash
# View tables in production
wrangler d1 execute nanotype-read-replica --command="SELECT name FROM sqlite_master WHERE type='table'"

# View tables locally
wrangler d1 execute nanotype-read-replica --local --command="SELECT name FROM sqlite_master WHERE type='table'"
```

**Expected output:**
```
┌───────┐
│ name  │
├───────┤
│ tasks │
└───────┘
```

### Step 5: Deploy Worker

```bash
# Build the React frontend
npm run build

# Deploy to Cloudflare
wrangler deploy
```

**Output:**
```
Total Upload: 2082.01 KiB / gzip: 339.53 KiB
Uploaded nanotype-db (2.03 sec)
Published nanotype-db (0.28 sec)
  https://nanotype-db.yourname.workers.dev
Current Deployment ID: abc123-deployment-id
```

### Step 6: Verify Sync Engine

After deployment, test the Sync Engine:

```javascript
// In your browser console or client app
const ws = new WebSocket('wss://nanotype-db.yourname.workers.dev?room_id=test-room');

ws.onopen = () => {
  // Check sync status
  ws.send(JSON.stringify({
    action: 'rpc',
    method: 'getSyncStatus'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Sync Status:', data);
  
  // Expected: { isHealthy: true, totalSyncs: 1, ... }
};
```

## Local Development

### Setup Local D1 Database

```bash
# Create local D1 database
wrangler d1 execute nanotype-read-replica --local --file=./migrations/0001_read_replica_schema.sql

# Verify it works
wrangler d1 execute nanotype-read-replica --local --command="SELECT * FROM tasks"
```

### Run Development Server

```bash
# Terminal 1: Start Vite dev server for React
npm run dev

# Terminal 2: Start Wrangler dev server (optional, for testing workers locally)
wrangler dev
```

**Note**: Local development uses `.wrangler/state` for persistence.

## Monitoring and Operations

### Check Sync Health

Use the RPC method to monitor sync status:

```javascript
ws.send(JSON.stringify({
  action: 'rpc',
  method: 'getSyncStatus'
}));

// Response format:
{
  "type": "query_result",
  "data": [{
    "isHealthy": true,
    "lastSyncTime": 1707134066798,
    "lastSyncAge": 124,
    "totalSyncs": 1523,
    "syncErrors": 2,
    "errorRate": "0.13%",
    "replicaAvailable": true
  }]
}
```

### Force Re-Sync

If you need to manually sync all data:

```javascript
ws.send(JSON.stringify({
  action: 'rpc',
  method: 'forceSyncAll'
}));
```

### View D1 Data

Check what's in your D1 database:

```bash
# Production
wrangler d1 execute nanotype-read-replica --command="SELECT * FROM tasks"

# Local
wrangler d1 execute nanotype-read-replica --local --command="SELECT * FROM tasks"
```

## Troubleshooting

### Issue: Sync errors in logs

**Symptom:** Console shows "D1 replication failed"

**Solutions:**
1. Verify D1 database ID in `wrangler.toml`
2. Check D1 database exists: `wrangler d1 list`
3. Verify migration ran: `wrangler d1 execute nanotype-read-replica --command="SELECT * FROM sqlite_master"`

### Issue: D1 database not found

**Symptom:** "Database not found" errors

**Solutions:**
1. Create the database: `wrangler d1 create nanotype-read-replica`
2. Update `database_id` in `wrangler.toml`
3. Run migration again

### Issue: No data in D1

**Symptom:** D1 queries return empty results

**Solutions:**
1. Create some data via DO: `createTask` RPC
2. Force sync: `forceSyncAll` RPC
3. Check sync status: `getSyncStatus` RPC
4. Verify sync is healthy (no errors)

### Issue: Sync is slow or laggy

**Symptom:** Data takes >1 second to appear in D1

**Solutions:**
1. This is normal - sync is asynchronous
2. Typical lag is 50-100ms
3. For real-time data, read from DO directly
4. For lists/dashboards, D1 is perfect

## Performance Tuning

### Optimize for Read-Heavy Workloads

If you have >1000 concurrent users reading data:

1. ✅ **Use D1 for reads** - This is automatic with Sync Engine
2. ✅ **Monitor sync health** - Check `getSyncStatus` regularly
3. ✅ **Use indexes** - D1 has indexes on `room_id` and `status`
4. ✅ **Cache on client** - Reduce round trips

### Optimize for Write-Heavy Workloads

If you have many writes per second:

1. ✅ **Use DO for writes** - Already automatic
2. ✅ **Batch operations** - Sync Engine batches automatically
3. ⚠️ **Monitor sync lag** - Check `lastSyncAge` metric
4. ⚠️ **Consider queue** - For extremely high write rates

## Cost Estimation

### Cloudflare Free Tier

- **Workers**: 100,000 requests/day (free)
- **D1**: 5M reads/day, 100k writes/day (free)
- **Durable Objects**: 1M requests/month (free)

### Typical App Usage

For a small-medium app with 1000 daily active users:
- **DO writes**: ~10k/day (well within free tier)
- **D1 reads**: ~100k/day (well within free tier)
- **Total cost**: $0/month

For a larger app with 100k daily active users:
- **DO writes**: ~1M/day = ~$0.15/day = **~$4.50/month**
- **D1 reads**: ~10M/day = ~$0.30/day = **~$9/month**
- **Total cost**: **~$13.50/month**

Compare to Convex: **$25-100/month** for similar scale

## Next Steps

1. ✅ Deploy to production (completed above)
2. ✅ Monitor sync health
3. 📊 Build dashboards using D1 reads
4. 🚀 Scale to thousands of concurrent users
5. 💰 Save money vs. Convex

## Resources

- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [ACTOR_MODEL.md](./ACTOR_MODEL.md) - Architecture details
- [EXAMPLES.md](./EXAMPLES.md) - Usage examples
- [migrations/README.md](./migrations/README.md) - Migration details

## Support

Having issues? Check:
1. [Cloudflare Community](https://community.cloudflare.com/)
2. [GitHub Issues](https://github.com/getwebface/nano-type-db/issues)
3. [Cloudflare Discord](https://discord.gg/cloudflare)
