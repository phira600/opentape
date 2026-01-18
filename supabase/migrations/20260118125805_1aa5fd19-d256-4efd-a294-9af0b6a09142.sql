-- Add admin authorization check to cleanup_old_trades_batch function
CREATE OR REPLACE FUNCTION public.cleanup_old_trades_batch(cutoff_date timestamp with time zone, batch_size integer DEFAULT 20000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $function$
DECLARE
  deleted_count INT;
BEGIN
  -- Require admin role or service_role access
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
  END IF;

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
$function$;

-- Add admin authorization check to cleanup_old_candles_batch function
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
  -- Require admin role or service_role access
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
  END IF;

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

-- Add admin authorization check to cleanup_old_activity_logs_batch function
CREATE OR REPLACE FUNCTION public.cleanup_old_activity_logs_batch(cutoff_date timestamp with time zone, batch_size integer DEFAULT 20000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  deleted_count INT;
BEGIN
  -- Require admin role or service_role access
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
  END IF;

  WITH deleted AS (
    DELETE FROM activity_logs
    WHERE ctid IN (
      SELECT ctid FROM activity_logs
      WHERE created_at < cutoff_date
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$function$;

-- Add admin authorization check to cleanup_old_trades function (original)
CREATE OR REPLACE FUNCTION public.cleanup_old_trades()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Require admin role or service_role access
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
  END IF;

  DELETE FROM public.trades_normalized
  WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM public.activity_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  RETURN deleted_count;
END;
$function$;

-- Add admin authorization check to cleanup_old_trades with retention parameter
CREATE OR REPLACE FUNCTION public.cleanup_old_trades(retention_days integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Require admin role or service_role access
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role) 
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Admin access required to delete data';
  END IF;

  DELETE FROM public.trades_normalized
  WHERE created_at < NOW() - (retention_days || ' days')::interval;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM public.activity_logs
  WHERE created_at < NOW() - (retention_days || ' days')::interval;
  
  RETURN deleted_count;
END;
$function$;