-- Simplified cleanup function - no trigger manipulation
-- The delete trigger is slow but we avoid lock conflicts
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date timestamptz, 
  batch_size integer DEFAULT 10000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $$
DECLARE
  deleted_count INT;
BEGIN
  -- Permission check
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
  END IF;

  -- Delete trades in batch using ctid for efficiency
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

  RETURN deleted_count;
END;
$$;

-- Optimize the delete trigger to avoid expensive EXISTS queries
CREATE OR REPLACE FUNCTION public.decrement_daily_stats_on_trade_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  trade_date DATE;
BEGIN
  -- Calculate the trade date
  trade_date := (OLD.trade_time AT TIME ZONE 'UTC')::date;
  
  -- Simply decrement the trade count (fast, no subqueries)
  -- unique_symbols and unique_venues become estimates during bulk deletes
  -- but they're recalculated when new trades are inserted
  UPDATE daily_stats SET
    total_trades = GREATEST(0, total_trades - 1),
    last_updated = NOW()
  WHERE date = trade_date;
  
  RETURN OLD;
END;
$$;