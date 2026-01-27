

## Plan: Fix Trades Cleanup Performance by Optimizing Delete Trigger

### Problem Summary

The trades cleanup job fails because of a severe performance bottleneck in the `decrement_daily_stats_on_trade_delete` trigger. Here's what's happening:

| Metric | Current State |
|--------|---------------|
| Table Size | 12 GB (15.5 million rows) |
| Old Trades to Delete | 366,501 rows |
| Time per 20k Batch | ~10 seconds |
| Trigger Queries per Delete | 2 expensive EXISTS queries |
| Total Queries per Batch | 40,000 |

The trigger runs **two full table scans for every single deleted trade**, checking if other trades exist with the same symbol/venue. Deleting 20,000 trades means 40,000 expensive queries.

### Solution Overview

Replace the row-by-row trigger approach with a batch-aware cleanup that updates `daily_stats` once after all deletions are complete, rather than for each individual row.

---

### Phase 1: Create Optimized Batch Delete Function

Replace the current `cleanup_old_trades_batch` function with a new version that:

1. **Temporarily disables the trigger** before deletion
2. **Deletes trades in a single batch operation**
3. **Recalculates affected daily_stats in bulk** using a single aggregation query
4. **Re-enables the trigger** after completion

```sql
CREATE OR REPLACE FUNCTION cleanup_old_trades_batch(
  cutoff_date timestamptz, 
  batch_size integer DEFAULT 20000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  deleted_count INT;
  affected_dates DATE[];
BEGIN
  -- Permission check (existing)
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Step 1: Identify affected dates BEFORE deletion
  SELECT ARRAY_AGG(DISTINCT (trade_time AT TIME ZONE 'UTC')::date)
  INTO affected_dates
  FROM trades_normalized
  WHERE ctid IN (
    SELECT ctid FROM trades_normalized
    WHERE trade_time < cutoff_date
    LIMIT batch_size
  );

  -- Step 2: Disable the trigger temporarily
  ALTER TABLE trades_normalized DISABLE TRIGGER tr_decrement_daily_stats_on_trade_delete;

  -- Step 3: Delete trades without trigger overhead
  WITH deleted AS (
    DELETE FROM trades_normalized
    WHERE ctid IN (
      SELECT ctid FROM trades_normalized
      WHERE trade_time < cutoff_date
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  -- Step 4: Re-enable the trigger immediately
  ALTER TABLE trades_normalized ENABLE TRIGGER tr_decrement_daily_stats_on_trade_delete;

  -- Step 5: Recalculate daily_stats for affected dates (single bulk operation)
  UPDATE daily_stats ds SET
    total_trades = COALESCE(agg.trade_count, 0),
    unique_symbols = COALESCE(agg.symbol_count, 0),
    unique_venues = COALESCE(agg.venue_count, 0),
    last_updated = NOW()
  FROM (
    SELECT 
      (trade_time AT TIME ZONE 'UTC')::date as trade_date,
      COUNT(*) as trade_count,
      COUNT(DISTINCT symbol) as symbol_count,
      COUNT(DISTINCT venue) as venue_count
    FROM trades_normalized
    WHERE (trade_time AT TIME ZONE 'UTC')::date = ANY(affected_dates)
    GROUP BY (trade_time AT TIME ZONE 'UTC')::date
  ) agg
  WHERE ds.date = agg.trade_date;

  -- Handle dates with no remaining trades
  UPDATE daily_stats SET
    total_trades = 0,
    unique_symbols = 0,
    unique_venues = 0,
    last_updated = NOW()
  WHERE date = ANY(affected_dates)
    AND NOT EXISTS (
      SELECT 1 FROM trades_normalized 
      WHERE (trade_time AT TIME ZONE 'UTC')::date = daily_stats.date
    );

  RETURN deleted_count;
END;
$$;
```

---

### Phase 2: Reduce Batch Size and Increase Statement Timeout

Update the edge function to use smaller batches with longer timeouts:

**File:** `supabase/functions/cleanup-old-trades/index.ts`

```typescript
// Change from:
const BATCH_SIZE = 20000  // Too large with trigger overhead
const MAX_BATCHES = 150

// Change to:
const BATCH_SIZE = 10000  // Smaller but faster batches
const MAX_BATCHES = 50    // Limit total execution time
```

---

### Phase 3: Alternative - Simpler Trigger Optimization

If modifying the batch function is complex, an alternative is to optimize the trigger itself by using the existing indexes properly:

```sql
CREATE OR REPLACE FUNCTION decrement_daily_stats_on_trade_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  trade_date DATE;
BEGIN
  trade_date := (OLD.trade_time AT TIME ZONE 'UTC')::date;
  
  -- Simply decrement the trade count (fast, no subqueries)
  -- The unique_symbols and unique_venues are estimates that
  -- can be recalculated periodically if needed
  UPDATE daily_stats SET
    total_trades = GREATEST(0, total_trades - 1),
    last_updated = NOW()
  WHERE date = trade_date;
  
  RETURN OLD;
END;
$$;
```

This removes the expensive EXISTS queries entirely. The `unique_symbols` and `unique_venues` counts become slightly inaccurate during deletions but remain accurate for the purpose of dashboard statistics.

---

### Expected Performance Improvement

| Approach | Current | After Fix |
|----------|---------|-----------|
| Queries per 20k batch | 40,000 | 1-3 |
| Time per 20k batch | ~10 seconds | <1 second |
| Time for 366k trades | 200+ seconds | ~20 seconds |

---

### Files to Modify

| File | Change |
|------|--------|
| Database migration | Replace `cleanup_old_trades_batch` function |
| Database migration | Optionally simplify `decrement_daily_stats_on_trade_delete` trigger |
| `supabase/functions/cleanup-old-trades/index.ts` | Adjust batch size and add better error handling |

---

### Technical Details

**Why the trigger is slow:**

1. The `EXISTS` queries use `(trade_time AT TIME ZONE 'UTC')::date` which prevents index usage on the raw `trade_time` column
2. Even with `idx_trades_date_symbol` and `idx_trades_date_venue` indexes, the `id != OLD.id` condition forces a scan
3. Running 40,000 such queries per batch (2 per row x 20,000 rows) creates massive overhead
4. The trigger holds locks during the entire operation, blocking other queries

**Why disabling the trigger is safe:**

1. The edge function runs with `service_role` (full access)
2. The trigger is re-enabled immediately after deletion
3. The bulk recalculation ensures data consistency
4. No other process should be deleting trades simultaneously (controlled via job status)

