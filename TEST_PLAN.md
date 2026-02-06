# Test Plan for Spreadsheet UI Features

## Manual Testing Guide

### Prerequisites
1. Start the development server
2. Navigate to a table with data (e.g., tasks)
3. Ensure you have test data or use the ghost row to create some

### Test Suite 1: Inline Cell Editing

#### Test 1.1: Basic Text Edit
**Steps:**
1. Double-click any text cell (e.g., title)
2. Modify the text
3. Press Enter

**Expected:**
- Cell enters edit mode with green border
- Input field shows current value selected
- After Enter: Cell saves, exits edit mode
- All connected clients see the update

**Pass Criteria:** ✓ Cell updates successfully

#### Test 1.2: Cancel Edit
**Steps:**
1. Double-click a cell
2. Modify the text
3. Press Escape

**Expected:**
- Cell returns to display mode
- Original value restored
- No server call made

**Pass Criteria:** ✓ Edit cancelled, original value preserved

#### Test 1.3: Edit Multiple Cells Rapidly
**Steps:**
1. Double-click cell 1, edit, press Enter
2. Immediately double-click cell 2, edit, press Enter
3. Repeat for 5-10 cells quickly

**Expected:**
- All edits save successfully
- No conflicts or lost updates
- Rate limiting allows 100 updates/minute

**Pass Criteria:** ✓ All cells updated without errors

#### Test 1.4: Boolean Toggle
**Steps:**
1. Find a boolean or 0/1 integer column
2. Click the checkbox

**Expected:**
- Checkbox toggles immediately (optimistic)
- Value switches between 0 and 1
- Server confirms update
- All clients see toggle

**Pass Criteria:** ✓ Boolean toggles correctly

### Test Suite 2: Visual Column Types

#### Test 2.1: Status Rendering
**Steps:**
1. Find status column with values: pending, completed, failed
2. Observe rendering

**Expected:**
- Pending: Yellow pill badge
- Completed: Green pill badge  
- Failed: Red pill badge
- Badges have rounded corners and borders

**Pass Criteria:** ✓ All status values render as colored pills

#### Test 2.2: Date Rendering
**Steps:**
1. Find a date/timestamp column
2. Observe rendering

**Expected:**
- Calendar icon displayed
- Date in localized format (e.g., 2/6/2024)
- Time if available (e.g., 12:00:00 PM)

**Pass Criteria:** ✓ Dates render with icon and proper format

#### Test 2.3: JSON Rendering
**Steps:**
1. Find a JSON column or object value
2. Observe rendering

**Expected:**
- JSON icon displayed
- {...} placeholder shown
- Blue color for distinction
- (Future: Click to expand)

**Pass Criteria:** ✓ JSON renders with icon and placeholder

### Test Suite 3: Ghost Row

#### Test 3.1: Add Single Row
**Steps:**
1. Scroll to bottom of grid
2. Click title cell in ghost row (dashed border)
3. Type "Test Task"
4. Press Tab or click status cell
5. Type "pending"
6. Press Enter

**Expected:**
- Ghost row activates on click
- Can type in each cell
- Press Enter inserts row
- New row appears above ghost row
- Ghost row clears and remains at bottom

**Pass Criteria:** ✓ Row inserted successfully

#### Test 3.2: Add Row with Partial Data
**Steps:**
1. Click title cell in ghost row
2. Type "Partial Task"
3. Press Enter (skip status)

**Expected:**
- Row inserted with title only
- Other fields get defaults (null or empty)
- Ghost row ready for next entry

**Pass Criteria:** ✓ Partial row inserted with defaults

#### Test 3.3: Cancel Ghost Row Entry
**Steps:**
1. Click title cell in ghost row
2. Type some text
3. Press Escape

**Expected:**
- Input clears
- Ghost row deactivates
- No row inserted

**Pass Criteria:** ✓ Ghost row cancelled successfully

#### Test 3.4: Ghost Row Persistence
**Steps:**
1. Insert 5 rows using ghost row
2. Refresh page
3. Check ghost row still appears

**Expected:**
- Ghost row always at bottom
- Persists after inserts
- Persists after page refresh

**Pass Criteria:** ✓ Ghost row always available

### Test Suite 4: Column Sorting

#### Test 4.1: Sort Ascending
**Steps:**
1. Click any column header (e.g., Title)
2. Observe arrow icon and data order

**Expected:**
- Arrow icon appears (green highlight)
- Data sorts A-Z or 0-9
- Sort is instant (client-side)

**Pass Criteria:** ✓ Data sorted correctly ascending

#### Test 4.2: Sort Descending
**Steps:**
1. Click same column header again
2. Observe arrow direction and data order

**Expected:**
- Arrow direction changes
- Data sorts Z-A or 9-0
- Toggle works correctly

**Pass Criteria:** ✓ Data sorted correctly descending

#### Test 4.3: Sort Different Columns
**Steps:**
1. Sort by Title (ascending)
2. Then sort by Status (ascending)
3. Then sort by ID (descending)

**Expected:**
- Each column sorts independently
- Previous sort is cleared
- Active column shows green highlight

**Pass Criteria:** ✓ Column switching works correctly

#### Test 4.4: Sort with Updates
**Steps:**
1. Sort by Title
2. Edit a cell to change sort order
3. Observe automatic re-sort

**Expected:**
- (Current: Manual re-sort needed)
- (Future: Auto re-sort on data change)

**Pass Criteria:** ℹ️ Known limitation - manual re-sort needed

### Test Suite 5: CSV Import

#### Test 5.1: File Picker Import
**Steps:**
1. Create CSV file:
   ```
   title,status
   Task 1,pending
   Task 2,completed
   Task 3,pending
   ```
2. Click "Import CSV" button
3. Select the file
4. Observe results

**Expected:**
- File picker opens
- After selection, import starts
- Console shows success message
- 3 new rows appear in grid
- All clients see new data

**Pass Criteria:** ✓ CSV imported successfully via file picker

#### Test 5.2: Drag & Drop Import
**Steps:**
1. Create CSV file (same as above)
2. Drag file onto the DataGrid
3. Observe overlay appears
4. Drop file
5. Observe results

**Expected:**
- Drag overlay shows "Drop CSV File Here"
- After drop, import starts
- Console shows success message
- Rows inserted correctly

**Pass Criteria:** ✓ CSV imported successfully via drag & drop

#### Test 5.3: Import with Invalid Data
**Steps:**
1. Create CSV with missing columns:
   ```
   title
   Task 1
   Task 2
   ```
2. Import the file

**Expected:**
- Import attempts
- Missing columns use defaults
- Partial success

**Pass Criteria:** ✓ Handles missing columns gracefully

#### Test 5.4: Import Large File (>1000 rows)
**Steps:**
1. Create CSV with 1500 rows
2. Attempt import

**Expected:**
- Server rejects with error
- Error message: "Batch size limited to 1000 rows"
- No data inserted

**Pass Criteria:** ✓ Rate limit enforced correctly

#### Test 5.5: CSV with Quoted Commas
**Steps:**
1. Create CSV:
   ```
   title,status
   "Smith, John",pending
   ```
2. Import the file

**Expected:**
- (Current: Fails - parser doesn't handle quotes)
- Console shows error or incorrect parsing

**Pass Criteria:** ℹ️ Known limitation - documented in code

### Test Suite 6: Toolbar & Filters

#### Test 6.1: Filter Toggle
**Steps:**
1. Click "Filters" button
2. Observe panel
3. Click again to close

**Expected:**
- Panel expands showing filter UI
- Badge shows "(0)" initially
- Panel collapses on second click

**Pass Criteria:** ✓ Filter panel toggles correctly

#### Test 6.2: Row Count Display
**Steps:**
1. Observe row count in toolbar
2. Add a row via ghost row
3. Observe count updates

**Expected:**
- Count shows "X rows"
- Updates in real-time as rows change

**Pass Criteria:** ✓ Row count accurate and updates

### Test Suite 7: Security & Edge Cases

#### Test 7.1: SQL Injection Attempt
**Steps:**
1. Double-click a cell
2. Enter: `'; DROP TABLE tasks; --`
3. Press Enter

**Expected:**
- Value saved as literal string
- No SQL execution
- Table still exists

**Pass Criteria:** ✓ SQL injection prevented

#### Test 7.2: Rate Limiting
**Steps:**
1. Write a script to update cells >100 times/minute
2. Observe behavior after limit

**Expected:**
- After 100 updates: Error message
- "Rate limit exceeded. Please slow down."
- No further updates until cooldown

**Pass Criteria:** ✓ Rate limiting enforced

#### Test 7.3: Invalid Table Name
**Steps:**
1. Modify client code to call updateRow with table: "hackers"
2. Attempt update

**Expected:**
- Server rejects request
- Error: "Table 'hackers' is not allowed for updates"

**Pass Criteria:** ✓ Table whitelist enforced

#### Test 7.4: Invalid Field Name
**Steps:**
1. Modify client code to use field: "id; DROP TABLE"
2. Attempt update

**Expected:**
- Server rejects request
- Error: "Invalid field name format"

**Pass Criteria:** ✓ Field validation enforced

#### Test 7.5: Concurrent Edits
**Steps:**
1. Open app in two browser tabs
2. Tab 1: Edit cell A
3. Tab 2: Edit same cell A simultaneously
4. Both save

**Expected:**
- Last write wins (standard behavior)
- Both clients see final state
- (Future: Conflict resolution)

**Pass Criteria:** ℹ️ Last write wins (acceptable for MVP)

### Test Suite 8: Performance

#### Test 8.1: Large Dataset
**Steps:**
1. Load table with 500+ rows
2. Scroll through data
3. Edit cells
4. Sort columns

**Expected:**
- Smooth scrolling
- No lag on edits
- Sort completes in <1 second

**Pass Criteria:** ✓ Performance acceptable

#### Test 8.2: Network Latency
**Steps:**
1. Simulate slow network (Chrome DevTools)
2. Edit cells
3. Observe behavior

**Expected:**
- Optimistic updates show immediately
- Spinner or loading state during save
- Rollback if network fails

**Pass Criteria:** ✓ Graceful degradation

## Automated Testing (Future)

### Unit Tests Needed
- [ ] EditableCell component
- [ ] GhostRow component
- [ ] CSV parser function
- [ ] Sort algorithm
- [ ] RPC call handling

### Integration Tests Needed
- [ ] End-to-end cell edit flow
- [ ] CSV import full pipeline
- [ ] WebSocket communication
- [ ] Multi-client synchronization

### E2E Tests Needed
- [ ] Complete user journey (add, edit, sort, import)
- [ ] Error handling paths
- [ ] Security attack scenarios

## Test Results Summary

**Date:** 2024-02-06

| Test Suite | Total | Passed | Failed | Known Issues |
|------------|-------|--------|--------|--------------|
| Inline Editing | 4 | - | - | - |
| Visual Types | 3 | - | - | - |
| Ghost Row | 4 | - | - | - |
| Sorting | 4 | - | - | 1 (auto re-sort) |
| CSV Import | 5 | - | - | 1 (quoted commas) |
| Toolbar | 2 | - | - | - |
| Security | 5 | - | - | 1 (concurrent edits) |
| Performance | 2 | - | - | - |
| **TOTAL** | **29** | - | - | **3** |

**Known Issues:**
1. Auto re-sort after data change (manual re-sort needed)
2. CSV parser doesn't handle quoted commas (documented)
3. Concurrent edits use last-write-wins (acceptable for MVP)

## Sign-off

**Tester:** _________________
**Date:** _________________
**Status:** [ ] All Critical Pass [ ] Some Failures [ ] Not Tested
