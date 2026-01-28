
## Plan: Display Last Run and Next Run Times in Local Time

### Overview

Change the "Last Run" and "Next Run" columns from relative times (e.g., "4 minutes ago") to absolute local times (e.g., "28 Jan 09:25") in the user's browser timezone.

### Current vs. Proposed Display

| Column | Current Display | Proposed Display |
|--------|-----------------|------------------|
| Last Run | "4 minutes ago" | "28 Jan 09:25" |
| Next Run | "5m", "Soon", "10:30" | "28 Jan 10:30" |

### Changes Required

#### 1. Add a Helper Function for Local Time Formatting

Create a new formatting function that displays timestamps in the user's local timezone:

```typescript
const formatLocalTime = (dateStr: string | null): string => {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  return format(date, "d MMM HH:mm"); // e.g., "28 Jan 09:25"
};
```

The `date-fns` `format()` function automatically uses the browser's local timezone.

#### 2. Update Data Ingestion Jobs - Last Run (line 914)

**Before:**
```typescript
{formatDistanceToNow(new Date(job.last_run_at), { addSuffix: true })}
```

**After:**
```typescript
{formatLocalTime(job.last_run_at)}
```

#### 3. Update `getNextRunTime()` Function (lines 734-772)

Modify to return the formatted local time instead of relative strings:

**Key changes:**
- If `next_run_at` exists, return formatted date like "28 Jan 09:25"
- If job is disabled/running/pending, keep the status text
- Remove relative time logic (seconds/minutes countdown)

**New function:**
```typescript
const getNextRunTime = (job: JobConfiguration) => {
  if (!job.is_enabled) return { text: "Disabled", isStatus: true };
  if (job.last_status === "running") return { text: "Running", isStatus: true };
  
  if (job.next_run_at) {
    const nextRun = new Date(job.next_run_at);
    const now = new Date();
    
    if (nextRun <= now) {
      return { text: "Soon", isStatus: true };
    }
    
    return { text: format(nextRun, "d MMM HH:mm"), isStatus: false };
  }
  
  if (!job.last_run_at) return { text: "Pending", isStatus: true };
  
  // Fallback calculation
  const lastRun = new Date(job.last_run_at);
  const interval = job.fetch_interval_seconds || 60;
  const nextRun = addSeconds(lastRun, interval);
  
  return { text: format(nextRun, "d MMM HH:mm"), isStatus: false };
};
```

#### 4. Update Next Run Display (lines 920-932)

Adjust the JSX to use the new return structure (rename `relative` to `isStatus` for clarity).

#### 5. Update Cron Jobs - Last Run (line 1157)

**Before:**
```typescript
{formatDistanceToNow(new Date(cronJob.last_run_at), { addSuffix: true })}
```

**After:**
```typescript
{formatLocalTime(cronJob.last_run_at)}
```

---

### Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `src/components/dashboard/DataSourceTable.tsx` | ~35 | Ensure `format` is imported from date-fns (already is) |
| `src/components/dashboard/DataSourceTable.tsx` | ~600 | Add `formatLocalTime()` helper function |
| `src/components/dashboard/DataSourceTable.tsx` | 734-772 | Update `getNextRunTime()` to return absolute times |
| `src/components/dashboard/DataSourceTable.tsx` | 914 | Replace relative time with `formatLocalTime()` for Data Jobs Last Run |
| `src/components/dashboard/DataSourceTable.tsx` | 920-932 | Update Next Run display logic |
| `src/components/dashboard/DataSourceTable.tsx` | 1157 | Replace relative time with `formatLocalTime()` for Cron Jobs Last Run |

### Technical Notes

- The `date-fns` `format()` function is already imported (line 35)
- `format()` automatically uses the browser's local timezone
- Format pattern `"d MMM HH:mm"` produces "28 Jan 09:25" (day, abbreviated month, 24-hour time)
- Status strings like "Disabled", "Running", "Pending", "Soon" remain unchanged
- Tooltips with hover for full date/time could be added as a future enhancement
