-- Use a lock timeout to avoid blocking issues, and skip trigger disable/enable
-- if we can't acquire the lock (safer approach)
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date timestamptz, 
  batch_size integer DEFAULT 10000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
SET lock_timeout TO '5s'
AS $$
DECLARE
  deleted_count INT;
  affected_dates DATE[];
  trigger_disabled BOOLEAN := FALSE;
BEGIN
  -- Permission check
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
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

  -- If no trades to delete, return early
  IF affected_dates IS NULL THEN
    RETURN 0;
  END IF;

  -- Step 2: Try to disable trigger, but continue even if we can't
  BEGIN
    ALTER TABLE trades_normalized DISABLE TRIGGER tr_decrement_daily_stats_on_trade_delete;
    trigger_disabled := TRUE;
  EXCEPTION WHEN lock_not_available THEN
    -- Can't get lock, proceed without disabling trigger
    -- This is slower but won't block other operations
    trigger_disabled := FALSE;
  END;

  -- Step 3: Delete trades
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

  -- Step 4: Re-enable trigger if we disabled it
  IF trigger_disabled THEN
    ALTER TABLE trades_normalized ENABLE TRIGGER tr_decrement_daily_stats_on_trade_delete;
    
    -- Step 5: Recalculate daily_stats for affected dates (only if trigger was disabled)
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
  END IF;

  RETURN deleted_count;
END;
$$;