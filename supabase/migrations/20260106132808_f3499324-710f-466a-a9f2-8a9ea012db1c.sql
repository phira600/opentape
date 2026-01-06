-- Add index on trade_time to speed up cleanup queries
CREATE INDEX IF NOT EXISTS idx_trades_normalized_trade_time 
ON trades_normalized (trade_time);

-- Update the batch function with a statement timeout
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date TIMESTAMPTZ,
  batch_size INT DEFAULT 5000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM trades_normalized
    WHERE ctid IN (
      SELECT ctid FROM trades_normalized
      WHERE trade_time < cutoff_date
      ORDER BY trade_time
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$;