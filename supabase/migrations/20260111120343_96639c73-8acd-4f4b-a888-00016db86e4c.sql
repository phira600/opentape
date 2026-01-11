-- Create batch cleanup function for old candles
CREATE OR REPLACE FUNCTION public.cleanup_old_candles_batch(cutoff_date timestamp with time zone, batch_size integer DEFAULT 20000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM candles_1min
    WHERE ctid IN (
      SELECT ctid FROM candles_1min
      WHERE bucket < cutoff_date
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$function$;

-- Insert default configuration for cleanup-old-candles job
INSERT INTO cron_job_configurations (id, name, schedule, description, is_enabled, retention_days)
VALUES (
  'cleanup-old-candles',
  'Cleanup Old Candles',
  '0 */4 * * *',
  'Cleans up old candles based on retention settings (every 4 hours)',
  true,
  14
)
ON CONFLICT (id) DO NOTHING;