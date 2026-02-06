# Database Migration System

## Overview

The enhanced migration system provides production-ready database version control with:

- ✅ **Version Tracking**: All applied migrations are tracked in a `_migrations` table
- ✅ **Rollback Support**: Migrations can be rolled back to any previous version
- ✅ **Dry-Run Mode**: Test migrations without applying changes
- ✅ **Structured Logging**: JSON-formatted logs for monitoring and debugging
- ✅ **Multi-Database Support**: Handles both READ_REPLICA and AUTH databases
- ✅ **Validation**: Ensures migrations are applied in order

## Commands

### Apply Migrations (Up)

Apply all pending migrations:
```bash
npm run migrate:up
```

Apply migrations up to a specific version:
```bash
npm run migrate:enhanced up 5
```

Dry-run (preview without applying):
```bash
npm run migrate:enhanced up --dry-run
```

Local development:
```bash
npm run migrate:enhanced up --local
```

### Rollback Migrations (Down)

Rollback to a specific version (requires target version):
```bash
npm run migrate:down 3
```

This will rollback all migrations **after** version 3.

**Note:** Rollback requires `.rollback.sql` files for each migration.

### Check Status

View which migrations are applied vs pending:
```bash
npm run migrate:status
```

Output example:
```
=== READ REPLICA DATABASE ===
✅ Applied - v1: 0001_read_replica_schema
✅ Applied - v3: 0003_add_vector_status
⏳ Pending - v6: 0006_add_task_user_id

=== AUTH DATABASE ===
✅ Applied - v2: 0002_api_keys
✅ Applied - v4: 0004_rooms_table
⏳ Pending - v5: 0005_add_permissions_table
```

## Migration File Format

### Naming Convention

Migrations must follow this pattern:
```
<version>_<description>.sql
```

Examples:
- `0001_read_replica_schema.sql`
- `0002_api_keys.sql`
- `0003_add_vector_status.sql`

### Database Assignment

The migration runner automatically determines which database to use:

- **AUTH Database**: Files containing `api_keys`, `rooms`, `permissions`, or `user_tier`
- **READ_REPLICA Database**: All other files

### Rollback Files (Optional)

Create a corresponding rollback file for each migration:
```
<version>_<description>.rollback.sql
```

Example rollback file (`0002_api_keys.rollback.sql`):
```sql
-- Rollback migration 0002_api_keys
DROP TABLE IF EXISTS api_keys;
```

## Migration Tracking

Each migration is recorded in the `_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

This table is automatically created by the migration runner.

## Best Practices

### 1. Idempotent Migrations

Use `IF NOT EXISTS` and `IF EXISTS` to make migrations safe to re-run:

```sql
-- Good: Idempotent
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT;

-- Bad: Will fail on re-run
CREATE TABLE users (id TEXT PRIMARY KEY);
```

### 2. Incremental Versions

Always increment version numbers sequentially:
- ✅ 0001, 0002, 0003...
- ❌ 0001, 0003, 0010...

### 3. Test Before Production

Always test migrations locally first:
```bash
# Test with local D1
npm run migrate:enhanced up --local

# Preview changes
npm run migrate:enhanced up --dry-run
```

### 4. Create Rollback Files

For production safety, create rollback files for all migrations:
```bash
# Apply migration
npm run migrate:enhanced up

# If something goes wrong, rollback
npm run migrate:down <previous-version>
```

### 5. Backup Before Major Changes

Before running migrations in production:
```bash
# Create backup
wrangler d1 export nanotype-read-replica > backup.sql
wrangler d1 export nanotype-auth > backup-auth.sql

# Apply migrations
npm run migrate:up

# If needed, restore
wrangler d1 execute nanotype-read-replica --file=backup.sql
```

## Troubleshooting

### Migration Already Applied Error

If a migration shows as "already applied" but changes weren't made:

1. Check the `_migrations` table:
   ```bash
   wrangler d1 execute nanotype-read-replica --command="SELECT * FROM _migrations"
   ```

2. Manually remove the record:
   ```bash
   wrangler d1 execute nanotype-read-replica --command="DELETE FROM _migrations WHERE version = X"
   ```

3. Re-run the migration

### Wrangler Not Found

Ensure wrangler CLI is installed:
```bash
npm install -g wrangler
```

Or use npx:
```bash
npx wrangler d1 execute ...
```

### Migration Failed Mid-Way

If a migration fails partway through:

1. Check what was applied:
   ```bash
   wrangler d1 execute nanotype-read-replica --command="PRAGMA table_info(table_name)"
   ```

2. Manually fix or rollback:
   ```bash
   # Option 1: Manual SQL fix
   wrangler d1 execute nanotype-read-replica --command="DROP TABLE problematic_table"
   
   # Option 2: Use rollback file
   npm run migrate:down <previous-version>
   ```

3. Re-run the migration

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy with Migrations

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Install dependencies
        run: npm install
      
      - name: Run migrations (dry-run)
        run: npm run migrate:enhanced up --dry-run
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      
      - name: Apply migrations
        run: npm run migrate:up
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      
      - name: Deploy worker
        run: wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Security Considerations

### 1. Migration File Security

- ✅ Store migration files in version control
- ✅ Review all migrations in PR reviews
- ❌ Never include sensitive data in migrations
- ❌ Don't commit rollback files with production data

### 2. Production Access

- ✅ Use Cloudflare API tokens with minimal permissions
- ✅ Run migrations in a transaction when possible
- ✅ Test thoroughly in staging first
- ❌ Don't run migrations manually in production

### 3. Data Validation

Always validate data before and after migrations:
```sql
-- Check row count before
SELECT COUNT(*) FROM users;

-- Run migration
ALTER TABLE users ADD COLUMN email TEXT;

-- Verify data integrity
SELECT COUNT(*) FROM users WHERE email IS NULL;
```

## Advanced Usage

### Custom Database Names

Override database names via environment variables:
```bash
D1_DATABASE_NAME=my-custom-db npm run migrate:up
AUTH_D1_DATABASE_NAME=my-auth-db npm run migrate:up
```

### Conditional Migrations

Apply only specific versions:
```bash
# Apply only migration 0005
npm run migrate:enhanced up 5
```

### Batch Operations

Apply multiple migrations in sequence:
```bash
#!/bin/bash
for version in 1 2 3 4 5; do
  npm run migrate:enhanced up $version
  if [ $? -ne 0 ]; then
    echo "Migration $version failed, stopping"
    exit 1
  fi
done
```

## Future Enhancements

Planned improvements:
- [ ] Automatic backup before migrations
- [ ] Migration locking to prevent concurrent runs
- [ ] Schema validation after migrations
- [ ] Performance metrics (migration execution time)
- [ ] Email notifications on migration failures
- [ ] Web UI for migration management

## Support

For issues or questions:
1. Check the [migration logs](#structured-logging)
2. Review the [troubleshooting section](#troubleshooting)
3. Open an issue on GitHub with migration details
