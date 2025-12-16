-- Update cleanup_old_trades function to accept retention_days parameter
CREATE OR REPLACE FUNCTION public.cleanup_old_trades(retention_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.trades_normalized
  WHERE created_at < NOW() - (retention_days || ' days')::interval;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM public.activity_logs
  WHERE created_at < NOW() - (retention_days || ' days')::interval;
  
  RETURN deleted_count;
END;
$$;