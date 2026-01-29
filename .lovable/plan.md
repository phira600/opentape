

## Plan: Fix CBOE Time Window for File Discovery

### Corrected Logic

- **endTime** = `now` (look at all files currently on server)
- **startTime** = `now - 15min (publication delay) - fetch_interval - 10min (safety offset)`

### Example: 5-Minute Fetch Interval

```text
Run at 16:30 UK time:
  - endTime = 16:30 (now)
  - startTime = 16:00 (now - 15 - 5 - 10 = 30 min back)
  - Window: 16:00 to 16:30

Newest file on server: 16:15
Previous run at 16:25 processed files up to 16:10
New files found: 16:11, 16:12, 16:13, 16:14, 16:15 = 5 files
```

### File Changes

#### `supabase/functions/fetch-trade-files/index.ts`

**Change 1**: Update function signature (line ~507)

```typescript
async function fetchCboeDataSinceLastRun(
  venue: string, 
  lastRunAt: string | null, 
  fetchIntervalSeconds: number = 60
): Promise<FetchedFile[]>
```

**Change 2**: Replace time window calculation (lines ~515-536)

```typescript
const now = new Date()

// CBOE files are named with UK time, ~15 minutes behind current time
const PUBLICATION_DELAY_MS = 15 * 60 * 1000  // 15 minutes
const SAFETY_OFFSET_MS = 10 * 60 * 1000       // 10 minutes safety margin
const intervalMs = fetchIntervalSeconds * 1000

// End time: now (look at all files on server)
const endTime = now

// Start time: go back far enough to capture all new files
// Formula: now - publication_delay - fetch_interval - safety_offset
const lookbackMs = PUBLICATION_DELAY_MS + intervalMs + SAFETY_OFFSET_MS
let startTime = new Date(now.getTime() - lookbackMs)

// Cap at 2 hours max for recovery scenarios
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
if (startTime < twoHoursAgo) {
  startTime = twoHoursAgo
}

// Log for debugging
const windowMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000)
console.log(`CBOE ${venue.toUpperCase()}: Window ${format(startTime, "HH:mm")} to ${format(endTime, "HH:mm")} (${windowMinutes} min)`)
```

**Change 3**: Update CBOE fetch calls (around line 238)

```typescript
const cboeFiles = await fetchCboeDataSinceLastRun(venue, job.last_run_at, job.fetch_interval_seconds || 60)
```

### Expected Results

| Fetch Interval | Total Lookback | Files per Run |
|----------------|----------------|---------------|
| 1 min | 26 min | ~1 new |
| 5 min | 30 min | ~5 new |
| 10 min | 35 min | ~10 new |

Already-processed files are skipped via hash-based deduplication in `processed_files` table.

