# Row Level Security (RLS) and Psychic Search Implementation Summary

## Overview
This implementation addresses two critical security and billing concerns:
1. **Row Level Security (RLS)**: Prevents users from accessing tasks created by other users
2. **Psychic Search Protection**: Gates expensive AI features to pro-tier users only

## Changes Made

### 1. Database Schema Changes

#### Auth Schema (`src/db/auth-schema.ts`)
- Added `tier` field to `user` table (default: 'free')
- Added `permissions` table for fine-grained access control
  - Fields: id, user_id, room_id, table_name, can_read, can_write
  - Includes ON DELETE CASCADE for proper cleanup

#### D1 Migrations
- `0004_add_user_tier.sql`: Adds tier column to user table
- `0005_add_permissions_table.sql`: Creates permissions table with indexes
- `0006_add_task_user_id.sql`: Adds user_id column to tasks table

#### Durable Object Migration
- Added migration v6 to add `user_id` column to tasks table in SQLite

### 2. Row Level Security Implementation

#### createTask (`src/durable-object.ts`)
- Modified INSERT statement to include `user_id`
- Stores authenticated user ID with each task
- SQL: `INSERT INTO tasks (title, status, vector_status, user_id) VALUES (?, 'pending', 'pending', ?)`

#### listTasks (`src/durable-object.ts`)
- Added permission check against AUTH_DB permissions table
- Permission model:
  - If user has explicit read permission (`can_read = true`), returns ALL tasks in room
  - Otherwise, filters to show only tasks where `user_id` matches current user
- Prevents users from seeing other users' tasks without explicit permission

#### WebSocket User Tracking
- Added `webSocketUserIds: WeakMap<WebSocket, string>` to store user ID per connection
- User ID extracted from `X-User-ID` header during WebSocket upgrade
- Stored in WeakMap for access in message handlers
- Used consistently across all RPC methods for rate limiting and permissions

### 3. Psychic Search Protection

#### Tier Checking (`src/durable-object.ts`)
- Added tier check in `streamIntent` RPC method
- Queries AUTH_DB to verify user tier before processing
- Returns error if user is not 'pro' tier:
  - Error: "Psychic Search is a pro-tier feature. Please upgrade to access AI-powered auto-sensing."
  - Feature flag: "psychic_search"
- Fails closed: denies access if tier check fails

#### Frontend Integration (`App.tsx`)
- Added user tier fetching on app load
- Calls `/api/user-tier` endpoint (session-authenticated)
- Passes `psychic={isPro}` to DatabaseProvider
- Auto-sensing only enabled for pro users

#### User Tier Endpoint (`src/index.ts`)
- Added `/api/user-tier` endpoint
- Session-authenticated (no query parameters to prevent spoofing)
- Returns user's tier from AUTH_DB
- Defaults to 'free' if not found

#### UI Updates (`components/PsychicSearch.tsx`)
- Listens for tier-gating error messages
- Shows upgrade message when free user attempts to use feature
- Error detection via `feature: "psychic_search"` flag
- Graceful degradation: hides search interface, shows upgrade CTA

## Security Considerations

### RLS Security
- User ID comes from authenticated session header (`X-User-ID`)
- Header set by edge worker AFTER authentication
- Client cannot spoof this header
- Stored in WeakMap per WebSocket connection
- Consistent use across all RPC methods

### Psychic Search Security
- Tier check before expensive AI operations
- Prevents budget burn from free tier users
- Fails closed: denies access on error
- No client-side bypass possible
- Auto-sensing disabled at framework level for free users

### Permission Model
- Two-level access control:
  1. Default: Users see only their own tasks (filtered by user_id)
  2. Explicit: Users with `can_read` permission see all tasks in room
- Room isolation: Permissions scoped to room_id
- Table-level granularity: Different permissions per table

## Testing & Validation

### Automated Checks ✅
- Build: PASSED (no TypeScript errors)
- CodeQL Security Scan: PASSED (0 alerts)
- Code Review: PASSED (all issues addressed)

### Manual Testing Required
1. **RLS Testing**:
   - Create tasks as different users
   - Verify each user sees only their own tasks
   - Grant read permission to user
   - Verify user can see all tasks in room

2. **Tier Testing**:
   - Verify free users get upgrade message
   - Verify pro users can use Psychic Search
   - Verify auto-sensing disabled for free tier

3. **Integration Testing**:
   - Deploy to Cloudflare Workers
   - Run migrations on AUTH_DB and D1
   - Test end-to-end workflows

## Migration Steps

1. **AUTH_DB Migrations**:
   ```bash
   # Run migrations 0004 and 0005 on AUTH_DB
   wrangler d1 execute AUTH_DB --file=migrations/0004_add_user_tier.sql
   wrangler d1 execute AUTH_DB --file=migrations/0005_add_permissions_table.sql
   ```

2. **D1 Read Replica Migration**:
   ```bash
   # Run migration 0006 on D1
   wrangler d1 execute READ_REPLICA --file=migrations/0006_add_task_user_id.sql
   ```

3. **Durable Object Migration**:
   - Automatic: Migration v6 runs on next DO wake-up
   - No manual intervention needed

4. **Existing Data**:
   - Existing tasks will have `user_id = NULL`
   - Will not be visible to any user unless permissions granted
   - Consider backfilling user_id for existing tasks if needed

## Files Changed

1. `src/db/auth-schema.ts` - Added tier and permissions table
2. `src/durable-object.ts` - RLS implementation and tier checking
3. `src/index.ts` - Added /api/user-tier endpoint
4. `App.tsx` - Tier-based psychic feature gating
5. `components/PsychicSearch.tsx` - Upgrade message for free users
6. `migrations/0004_add_user_tier.sql` - New migration
7. `migrations/0005_add_permissions_table.sql` - New migration
8. `migrations/0006_add_task_user_id.sql` - New migration

## Backward Compatibility

- Existing users default to 'free' tier
- Existing tasks without user_id won't be visible (RLS filters them out)
- WebSocket connections maintain same API surface
- No breaking changes to client code
- Graceful degradation for missing permissions

## Future Improvements

1. **Backfill Script**: Update existing tasks with user_id
2. **Permission Management UI**: Allow room owners to grant permissions
3. **Role-Based Access**: Add roles (admin, member, viewer) with preset permissions
4. **Audit Log**: Track permission changes and access attempts
5. **Tier Management UI**: Allow users to upgrade/downgrade tier
6. **Billing Integration**: Connect tier to payment processor
