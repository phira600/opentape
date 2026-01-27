-- Optimized cleanup_old_trades_batch function that bypasses the slow trigger
-- and recalculates daily_stats in bulk after deletion
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date timestamptz, 
  batch_size integer DEFAULT 10000
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

  -- Step 2: Disable the trigger temporarily to avoid per-row overhead
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

  -- Handle dates with no remaining trades (set to zero)
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