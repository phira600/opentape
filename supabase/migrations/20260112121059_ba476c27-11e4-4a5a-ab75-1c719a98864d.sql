CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(
  cutoff_date timestamp with time zone, 
  batch_size integer DEFAULT 20000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '45s'
AS $function$
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
$function$