-- Update refresh_candles with lock timeout handling
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
SET lock_timeout TO '60s'
AS $$
DECLARE
  start_ts timestamptz;
  end_ts timestamptz;
  last_refresh timestamptz;
  refresh_from timestamptz;
  row_count integer;
BEGIN
  start_ts := clock_timestamp();
  
  -- Get last refresh time
  SELECT refreshed_at INTO last_refresh 
  FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  ORDER BY refreshed_at DESC 
  LIMIT 1;
  
  -- If no previous refresh, only do last hour to avoid timeout
  IF last_refresh IS NULL THEN
    refresh_from := now() - interval '1 hour';
  ELSE
    -- Go back 15 minutes from last refresh as buffer
    refresh_from := last_refresh - interval '15 minutes';
  END IF;
  
  -- Delete candles for buckets we're about to refresh
  DELETE FROM public.candles_1min 
  WHERE bucket >= date_trunc('minute', refresh_from);
  
  -- Insert fresh candles for the affected time range
  INSERT INTO public.candles_1min (symbol, venue, bucket, open, high, low, close, volume, trade_count)
  SELECT 
    symbol,
    venue,
    date_trunc('minute', trade_time) AS bucket,
    (array_agg(price ORDER BY trade_time))[1] AS open,
    max(price) AS high,
    min(price) AS low,
    (array_agg(price ORDER BY trade_time DESC))[1] AS close,
    sum(quantity) AS volume,
    count(*) AS trade_count
  FROM public.trades_normalized
  WHERE trade_time >= refresh_from
  GROUP BY symbol, venue, date_trunc('minute', trade_time)
  ON CONFLICT (symbol, venue, bucket) 
  DO UPDATE SET
    open = EXCLUDED.open,
    high = EXCLUDED.high,
    low = EXCLUDED.low,
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    trade_count = EXCLUDED.trade_count;
  
  end_ts := clock_timestamp();
  
  -- Get total row count (use estimate for speed)
  SELECT reltuples::bigint INTO row_count
  FROM pg_class WHERE relname = 'candles_1min';
  
  -- Log the refresh
  INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES ('candles_1min', now(), EXTRACT(MILLISECONDS FROM (end_ts - start_ts))::integer, COALESCE(row_count, 0));
  
  -- Keep only last 100 entries
  DELETE FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  AND id NOT IN (
    SELECT id FROM public.mv_refresh_log 
    WHERE view_name = 'candles_1min' 
    ORDER BY refreshed_at DESC 
    LIMIT 100
  );
END;
$$;