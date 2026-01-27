

## Plan: Add Configurable Fetch Frequency (in Minutes)

### Overview

Add the ability to configure how often fetch jobs run (in minutes instead of every minute). This will reduce edge function invocations and cloud costs significantly.

### Current vs. Proposed Behavior

| Aspect | Current | Proposed |
|--------|---------|----------|
| Fetch frequency | Every minute (fixed) | Configurable (1-60 minutes) |
| Cron schedule | `* 7-17 * * 1-5` | `*/5 7-17 * * 1-5` (if 5 min) |
| `fetch_interval_seconds` column | Exists but unused for cron | Used to build cron schedule |
| UI | No frequency control | Frequency slider/input in popover |

### Cost Impact

Setting fetch frequency to 5 minutes instead of 1 minute will reduce edge function invocations by 80%:
- Current: ~60 calls/hour per enabled job
- With 5-min interval: ~12 calls/hour per enabled job

---

### Changes Required

#### 1. UI Changes (`src/components/dashboard/DataSourceTable.tsx`)

Add a frequency input to the schedule configuration popover:

- Add `fetch_interval_minutes` to the `jobScheduleConfig` state
- Add a number input or slider for "Fetch Frequency (minutes)" with range 1-60
- Update `handleJobScheduleUpdate` to save `fetch_interval_seconds` (minutes * 60)
- Update `formatJobSchedule` to display the frequency
- Update the info popover to show "every X minutes" instead of raw seconds

#### 2. Edge Function Changes (`supabase/functions/provision-cron-jobs/index.ts`)

Modify `buildCronScheduleWithBuffer` to use the configured interval:

- Read `fetch_interval_seconds` from job configuration
- Convert to minutes for cron minute field
- Use `*/N` syntax for cron (e.g., `*/5` for every 5 minutes)
- Keep the DST buffer logic for hour range

Example cron outputs:
- 1 minute: `* 7-17 * * 1-5` (current behavior)
- 5 minutes: `*/5 7-17 * * 1-5`
- 15 minutes: `*/15 7-17 * * 1-5`
- 30 minutes: `0,30 7-17 * * 1-5`
- 60 minutes: `0 7-17 * * 1-5`

#### 3. Update Job Configuration Select Query

Update the select query in `provision-cron-jobs` to include `fetch_interval_seconds`.

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/DataSourceTable.tsx` | Add frequency input to schedule popover, update save handler |
| `supabase/functions/provision-cron-jobs/index.ts` | Use `fetch_interval_seconds` in cron schedule generation |

### UI Mockup

```text
+----------------------------------------+
| Schedule Configuration                  |
+----------------------------------------+
| Timezone: [Europe/London ▼]            |
|                                        |
| Fetch Frequency: [5] minutes           |
| (How often to check for new data)      |
|                                        |
| Run Days: [Mon] [Tue] [Wed] [Thu] [Fri]|
|                                        |
| Start Hour: [08:00]  End Hour: [17:00] |
|                                        |
| (Times are in Europe/London, adjusted  |
|  automatically for BST/GMT)            |
|                                        |
| [Save Schedule]                        |
+----------------------------------------+
```

### Technical Notes

- The `fetch_interval_seconds` column already exists in the database with default value 60
- No database migration needed
- The guard clause in `fetch-trade-files` will continue to work as-is (it checks local time, not frequency)
- The `calculateNextRunTime` function in `fetch-trade-files` already uses `fetch_interval_seconds` for next run calculation

