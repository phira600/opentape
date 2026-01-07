-- Create ASC index specifically for cleanup queries (more efficient than DESC)
CREATE INDEX IF NOT EXISTS idx_trades_cleanup_asc 
ON trades_normalized (trade_time ASC);

-- Update the batch function: remove ORDER BY (unnecessary overhead), increase default batch size
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date TIMESTAMPTZ,
  batch_size INT DEFAULT 20000
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
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$;