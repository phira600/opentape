

## Plan: Show Latest Stats Update Time (Not Just Today's)

### Problem

The "Stats Updated" card shows "Never" in the morning because the query only looks for today's `daily_stats` row. If no trades have been processed yet today, there's no row for today, so `last_updated` is null.

### Solution

Query the most recent `last_updated` timestamp from `daily_stats` across all dates, not just today.

### Changes Required

#### `src/components/dashboard/StatsCards.tsx`

**Change 1**: Add a query to get the latest `last_updated` from any date (around line 37)

```typescript
// Get the most recent stats update time (from any date)
const { data: latestStatsRow } = await supabase
  .from("daily_stats" as any)
  .select("last_updated")
  .order("last_updated", { ascending: false })
  .limit(1)
  .maybeSingle() as any;

const latestStatsUpdated = latestStatsRow?.last_updated || null;
```

**Change 2**: Update the stats object to use `latestStatsUpdated` instead of today's value (lines 56-63 and 87-94)

```typescript
// In both the dailyStats branch and fallback branch:
statsUpdated: latestStatsUpdated,
```

### Summary

| Location | Change |
|----------|--------|
| Lines ~37 | Add query for most recent `last_updated` across all dates |
| Line 62 | Use `latestStatsUpdated` in dailyStats branch |
| Line 93 | Use `latestStatsUpdated` in fallback branch |

### Expected Behavior

| Scenario | Before | After |
|----------|--------|-------|
| Morning before trades | "Never" | "29 Jan 17:30" (previous day's last update) |
| After first trade today | Today's time | Today's time |
| Weekend | "Never" | Friday's last update |

