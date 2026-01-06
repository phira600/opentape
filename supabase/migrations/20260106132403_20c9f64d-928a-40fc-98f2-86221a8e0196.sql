-- Create a batched cleanup function to avoid timeouts
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date TIMESTAMPTZ,
  batch_size INT DEFAULT 50000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM trades_normalized
    WHERE id IN (
      SELECT id FROM trades_normalized
      WHERE trade_time < cutoff_date
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$;