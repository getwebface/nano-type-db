# UI Enhancement Guide

## New Settings Interface

The Settings view now includes three tabs:

### 1. API Keys Tab
- Manage API keys for programmatic access
- Previously the only settings section

### 2. Snapshots Tab (NEW) 🆕
Browse and restore database backups from R2:
- **List View**: Shows all backups with metadata
  - Backup filename (timestamp-based)
  - Upload date/time
  - File size in human-readable format
- **Actions**:
  - Refresh: Reload backup list from R2
  - Rollback: Restore from selected backup
- **Visual Design**:
  - Green database icons for each backup
  - Orange "Rollback" buttons
  - Loading states during operations
  - Error messages for failed operations

**Example Backup Entry:**
```
┌─────────────────────────────────────────────────┐
│ 💾 backup-2024-01-15T12-34-56-789Z.db          │
│ 🕐 Jan 15, 2024, 12:34:56 PM                   │
│ 📦 2.5 MB                      [Rollback ↺]    │
└─────────────────────────────────────────────────┘
```

### 3. Analytics Tab (NEW) 🆕
Real-time usage analytics and cost estimation:

**Summary Cards:**
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Total Reads  │  │ Total Writes │  │ AI Operations│
│    15.2K     │  │    2.3K      │  │     487      │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Daily Usage Chart:**
- Last 14 days of activity
- Color-coded bars:
  - 🔵 Blue = Reads
  - 🟠 Orange = Writes
  - 🟣 Purple = AI Operations
- Hover to see exact counts

**Cost Breakdown:**
```
Read Units (15.2K × $0.00001)     $0.1520
Write Units (2.3K × $0.0001)      $0.2300
AI Operations (487 × $0.001)      $0.4870
─────────────────────────────────────────
Estimated Total                   $0.8690
```

## Navigation

Access the new tabs from the Settings button in the sidebar:

```
┌─────────────────┐
│ nanotypeDB      │
│ • demo-room     │
├─────────────────┤
│ Tables          │
│  📋 tasks       │
│  📋 users       │
├─────────────────┤
│ ⚙️  Settings    │ ← Click here
└─────────────────┘
```

Once in Settings:

```
Settings
┌──────────┬────────────┬─────────────┐
│ API Keys │ Snapshots  │  Analytics  │
└──────────┴────────────┴─────────────┘
  ^          ^            ^
  Old        New          New
```

## User Workflows

### Workflow 1: View Usage Analytics
1. Click "Settings" in sidebar
2. Click "Analytics" tab
3. View summary cards for quick overview
4. Scroll down to see daily breakdown chart
5. Review cost breakdown at bottom

### Workflow 2: Restore from Backup
1. Click "Settings" in sidebar
2. Click "Snapshots" tab
3. Click "Refresh" to load latest backups
4. Find desired backup by date/time
5. Click "Rollback" button
6. Confirm restoration
7. Wait for page reload with restored data

### Workflow 3: Monitor Queue Health
1. Check server logs for queue processing
2. View Analytics tab for AI operation trends
3. Dead letter queue captures failed jobs
4. Check Cloudflare dashboard for queue metrics

## Technical Details

### Queue Processing Flow
```
User creates task
     ↓
Task saved to SQLite (immediate)
     ↓
Job pushed to Queue
     ↓
Queue Consumer picks up job
     ↓
AI generates embedding (with retries)
     ↓
Vector indexed in Vectorize
     ↓
Status updated in SQLite
     ↓
Analytics logged to Analytics Engine
```

### Backup Storage Structure
```
R2 Bucket: nanotype-backups
│
├── backup-2024-01-15T12-00-00-000Z.db
├── backup-2024-01-15T13-00-00-000Z.db
├── backup-2024-01-15T14-00-00-000Z.db
└── ... (one per hour via cron)
```

### Analytics Data Flow
```
Every operation
     ↓
trackUsage() called
     ↓
SQLite _usage table updated
     ↓
Analytics Engine data point logged
     ↓
/analytics endpoint queries SQLite
     ↓
Frontend displays charts
```

## Color Scheme
- **Primary Action**: Green (#10b981)
- **Warning/Rollback**: Orange (#f97316)
- **Information**: Blue (#3b82f6)
- **AI/Advanced**: Purple (#a855f7)
- **Background**: Slate (#1e293b)
- **Text**: White/Slate-100

## Responsive Design
- Mobile: Stacked layout, single column
- Tablet: Grid layout with 2 columns
- Desktop: Full 3-column layout for summary cards
- All views maintain accessibility standards
