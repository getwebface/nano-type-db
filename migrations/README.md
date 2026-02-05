# D1 Read Replica Setup

This directory contains migrations for the D1 read replica database that enables horizontal scaling for read operations.

## Why D1 Read Replica?

The Durable Object architecture has a fundamental limitation:
- **Single-threaded execution**: Each DO instance runs on a single JavaScript thread
- **Blocking operations**: Synchronous `sql.exec()` calls block all other requests
- **Limited throughput**: A 5ms query limits throughput to ~200 queries/second
- **Vertical scaling only**: DOs scale by CPU speed, not horizontally

The D1 read replica solves this by:
- **Distributed reads**: D1 is distributed and scales horizontally
- **Offloaded queries**: Read operations use D1 instead of blocking the DO
- **Maintained consistency**: Writes still go through the DO and replicate to D1
- **Best of both worlds**: Strong consistency for writes, horizontal scaling for reads

## Setup Instructions

### 1. Create the D1 Database

```bash
# Create the D1 database
wrangler d1 create nanotype-read-replica

# Copy the database_id from the output and update wrangler.toml
```

### 2. Update wrangler.toml

Replace `placeholder-read-replica-id` in `wrangler.toml` with your actual database ID:

```toml
[[d1_databases]]
binding = "READ_REPLICA"
database_name = "nanotype-read-replica"
database_id = "your-actual-database-id-here"
```

### 3. Run Migrations

```bash
# Apply the migration to your D1 database
wrangler d1 execute nanotype-read-replica --file=./migrations/0001_read_replica_schema.sql

# For local development
wrangler d1 execute nanotype-read-replica --local --file=./migrations/0001_read_replica_schema.sql
```

## How It Works

### Write Path (Durable Object)
1. Client sends mutation (create/update/delete)
2. DO validates and writes to its SQLite storage
3. DO replicates the change to D1 asynchronously
4. DO broadcasts update to WebSocket subscribers

### Read Path (D1)
1. Client sends query (list/search/read)
2. DO forwards query to D1 read replica
3. D1 returns results (distributed, horizontally scaled)
4. Falls back to DO SQLite if D1 is unavailable

### Multi-tenancy
- Each DO instance (room) has a unique `doId`
- Data in D1 is tagged with `room_id` to ensure isolation
- Queries automatically filter by `room_id` for security

## Performance Benefits

| Scenario | Before (DO only) | After (DO + D1) |
|----------|-----------------|-----------------|
| Concurrent reads | Limited by single thread | Horizontally scaled |
| Query throughput | ~200/sec (5ms queries) | Thousands/sec |
| Write latency | Low (direct SQLite) | Same (DO SQLite) |
| Read latency | Low (same instance) | Slightly higher (network) |
| Scalability | Vertical only | Horizontal for reads |

## Trade-offs

### Advantages
✅ Horizontal scaling for read-heavy workloads
✅ No single point of failure for reads
✅ Maintains strong consistency for writes
✅ Automatic fallback to DO if D1 fails

### Considerations
⚠️ Slight replication lag (typically <100ms)
⚠️ Network overhead for D1 queries
⚠️ Additional complexity in deployment
⚠️ D1 has separate pricing (though generous free tier)

## Development vs Production

### Local Development
- D1 runs locally with `--local` flag
- Useful for testing replication logic
- May not reflect production performance

### Production
- D1 is globally distributed
- Automatic replication across Cloudflare's network
- Monitor D1 usage in Cloudflare dashboard

## Monitoring

Check replication health:
```bash
# Query D1 directly to verify replication
wrangler d1 execute nanotype-read-replica --command="SELECT COUNT(*) FROM tasks"

# Compare with DO data to ensure consistency
```

## Future Enhancements

- [x] Batch replication for initial sync (implemented via `batchSyncToD1`)
- [ ] Incremental batch replication for ongoing operations (e.g., batch every 100ms)
- [ ] Conflict resolution for concurrent writes across multiple DOs
- [ ] Read replica health checks with automatic circuit breaker
- [ ] Automatic failover strategies with retry logic
- [ ] Metrics and monitoring dashboards for sync performance
- [ ] Automatic failover strategies
- [ ] Metrics and monitoring dashboards
