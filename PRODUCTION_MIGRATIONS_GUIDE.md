# Production Database Migrations Guide

This guide explains how to properly set up and maintain your production databases, specifically addressing the **"no such table: api_keys"** error and ensuring all migrations are correctly applied.

## Overview

The NanoType DB uses two D1 databases:
1. **AUTH_DB** (`nanotype-auth`) - Stores user authentication, API keys, permissions, and rooms
2. **READ_REPLICA** (`nanotype-read-replica`) - Stores task data for read scaling

## Common Issues and Solutions

### Issue 1: Missing `api_keys` Table

**Error Message:**
```
Failed to fetch API keys: Failed to list API keys: D1_ERROR: no such table: api_keys: SQLITE_ERROR
```

**Root Cause:** The production `nanotype-auth` database was created but migrations were not applied.

**Solution:** Run the initial setup script and all pending migrations.

## Initial Database Setup

### Step 1: Create Databases (if not already created)

```bash
# Create AUTH database
wrangler d1 create nanotype-auth

# Create READ_REPLICA database  
wrangler d1 create nanotype-read-replica
```

Update `wrangler.toml` with the database IDs from the output.

### Step 2: Initialize AUTH Database

The `auth_init.sql` file contains the base schema for authentication, including the `api_keys` table.

**For Production:**
```bash
npx wrangler d1 execute nanotype-auth --remote --file=./auth_init.sql
```

**For Local Development:**
```bash
npx wrangler d1 execute nanotype-auth --local --file=./auth_init.sql
```

This creates the following tables:
- `user` - User accounts
- `session` - User sessions
- `account` - OAuth provider data
- `verification` - Email verification
- `api_keys` - **API keys for external access** ✅

### Step 3: Run Additional Migrations

After the initial setup, apply any additional migrations:

**For Production:**
```bash
npm run migrate:enhanced up --remote
```

**For Local Development:**
```bash
npm run migrate:enhanced up --local
```

This will apply migrations in order:
- `0001_read_replica_schema.sql` - Task tables for READ_REPLICA
- `0002_api_keys.sql` - Additional API keys enhancements (if any)
- `0003_add_vector_status.sql` - Vector search status
- `0004_add_user_tier.sql` - User tier for rate limiting
- `0004_rooms_table.sql` - Rooms for multi-tenancy
- `0005_add_permissions_table.sql` - Permissions system
- `0006_add_task_user_id.sql` - Task ownership tracking

## Migration Commands

### Check Migration Status

```bash
npm run migrate:status
```

Shows which migrations have been applied to each database.

### Apply All Pending Migrations

**Production:**
```bash
npm run migrate:enhanced up --remote
```

**Local:**
```bash
npm run migrate:enhanced up --local
```

### Apply Migrations Up to a Specific Version

```bash
npm run migrate:enhanced up 5 --remote
```

### Rollback to a Previous Version

```bash
npm run migrate:enhanced down 3 --remote
```

### Dry Run (See What Would Happen)

```bash
npm run migrate:enhanced up --dry-run --remote
```

## Verifying Database Setup

### Check Tables in AUTH_DB

**Production:**
```bash
npx wrangler d1 execute nanotype-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

**Local:**
```bash
npx wrangler d1 execute nanotype-auth --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected tables:
- `_cf_METADATA`
- // `tasks`
- `api_keys` ✅ (critical for API functionality)
- `permissions`
- `session`
- `user`
- `verification`

### Check Tables in READ_REPLICA

**Production:**
```bash
npx wrangler d1 execute nanotype-read-replica --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

**Local:**
```bash
npx wrangler d1 execute nanotype-read-replica --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected tables:
- `_cf_METADATA`
- `tasks`

## Troubleshooting

### API Keys Table Still Missing After Running Migrations

If the `api_keys` table is still missing after running migrations:

1. **Verify you're targeting the correct database:**
   ```bash
   npx wrangler d1 execute nanotype-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
   ```

2. **Re-run the auth initialization:**
   ```bash
   npx wrangler d1 execute nanotype-auth --remote --file=./auth_init.sql
   ```

3. **Check wrangler.toml configuration:**
   Ensure the database IDs match your actual production databases:
   ```toml
   [[d1_databases]]
   binding = "AUTH_DB"
   database_name = "nanotype-auth"
   database_id = "your-actual-database-id-here"
   ```

### CSV Import Timeout

**Error Message:**
```
CSV import failed: Error: RPC call to batchInsert timed out
```

**Solution:** The timeout has been increased from 10s to 60s for batch operations. For very large CSV imports:

1. The system now supports up to 10,000 rows per batch
2. Imports are processed in chunks of 100 rows with progress updates
3. If still experiencing timeouts, split your CSV into smaller files (< 5,000 rows recommended for optimal performance)

## Database Architecture

### AUTH_DB (nanotype-auth)
- **Purpose:** Authentication, authorization, API keys
- **Migrations:** `auth_init.sql`, `0002_api_keys.sql`, `0004_add_user_tier.sql`, `0004_rooms_table.sql`, `0005_add_permissions_table.sql`
- **Critical Tables:** `api_keys`, `user`, `session`, `permissions`

### READ_REPLICA (nanotype-read-replica)
- **Purpose:** Task data, read scaling
- **Migrations:** `0001_read_replica_schema.sql`, `0003_add_vector_status.sql`, `0006_add_task_user_id.sql`
- **Critical Tables:** `tasks`

## Best Practices

1. **Always backup before migrations:**
   ```bash
   npx wrangler d1 export nanotype-auth --remote --output=backup-auth-$(date +%Y%m%d).sql
   ```

2. **Test migrations locally first:**
   ```bash
   npm run migrate:enhanced up --local
   ```

3. **Use dry-run to preview changes:**
   ```bash
   npm run migrate:enhanced up --dry-run --remote
   ```

4. **Monitor migration status:**
   ```bash
   npm run migrate:status
   ```

5. **Version control your migrations:** Never modify existing migration files; create new ones instead.

## Emergency Recovery

If your production database is in a bad state:

1. **Export current data:**
   ```bash
   npx wrangler d1 export nanotype-auth --remote --output=emergency-backup.sql
   ```

2. **Reset and re-initialize (⚠️ DESTRUCTIVE):**
   ```bash
   # Only if absolutely necessary - this will delete all data!
   npx wrangler d1 execute nanotype-auth --remote --command="DROP TABLE IF EXISTS api_keys;"
   npx wrangler d1 execute nanotype-auth --remote --file=./auth_init.sql
   ```

3. **Restore data from backup:**
   ```bash
   npx wrangler d1 execute nanotype-auth --remote --file=emergency-backup.sql
   ```

## Support

For additional help:
- Check migration logs in `.wrangler/logs/`
- Review Cloudflare dashboard for D1 database status
- Ensure environment variables are set correctly (CLOUDFLARE_API_TOKEN for remote operations)
