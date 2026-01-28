
## Plan: Update Default Configurations for Setup/Installation

### Overview

Synchronize the default configurations in setup/installation edge functions with the current production scheduling. This ensures new installations get the optimized settings (timezone-aware schedules, 5-minute fetch intervals).

### Current Defaults vs. Required Defaults

#### Fetch Jobs (`provision-default-jobs`)

| Job | Current Default | Required Default |
|-----|-----------------|------------------|
| CBOE BXE/CXE/DXE | 06:00-21:00 UTC, 60s | 08:00-17:00 Europe/London, 300s |
| LSEG LSE/TRQX/TQEX | 06:00-21:00 UTC, 60s | 08:00-17:00 Europe/London, 300s |
| Nasdaq Nordic | 06:00-21:00 UTC, 60s | 09:00-18:00 Europe/Stockholm, 300s |

#### UI Defaults (`DataSourceTable.tsx`)

| Setting | Current Default | Required Default |
|---------|-----------------|------------------|
| `fetch_interval_minutes` | 1 | 5 |
| `timezone` | "UTC" | "Europe/London" |

---

### Files to Modify

#### 1. `supabase/functions/provision-default-jobs/index.ts`

Update the `DefaultJob` interface to include `timezone`, then update all job definitions:

```text
CBOE jobs (BXE, CXE, DXE):
  - timezone: 'Europe/London'
  - fetch_interval_seconds: 300
  - run_start_hour: 8
  - run_end_hour: 17

LSEG jobs (LSE, TRQX, TQEX):
  - timezone: 'Europe/London'
  - fetch_interval_seconds: 300
  - run_start_hour: 8
  - run_end_hour: 17

Nasdaq Nordic:
  - timezone: 'Europe/Stockholm'
  - fetch_interval_seconds: 300
  - run_start_hour: 9
  - run_end_hour: 18
```

#### 2. `src/components/dashboard/DataSourceTable.tsx`

Update the `jobScheduleConfig` initial state default:

```typescript
// Change from:
fetch_interval_minutes: 1,
timezone: "UTC",

// To:
fetch_interval_minutes: 5,
timezone: "Europe/London",
```

---

### Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/provision-default-jobs/index.ts` | Add `timezone` field, update all 7 jobs with correct hours, timezone, and 5-min intervals |
| `src/components/dashboard/DataSourceTable.tsx` | Update default `fetch_interval_minutes` from 1 to 5, `timezone` from "UTC" to "Europe/London" |

### Edge Function Deployment

After changes, the `provision-default-jobs` function will need to be deployed for new installations to use the updated defaults. Existing installations are unaffected since jobs already exist.
