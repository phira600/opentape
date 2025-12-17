-- Update refresh_candles function with incremental refresh using last_trade_id
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
SET lock_timeout TO '60s'
AS $function$
DECLARE
  start_ts timestamptz;
  end_ts timestamptz;
  last_refresh timestamptz;
  refresh_from timestamptz;
  row_count integer;
BEGIN
  start_ts := clock_timestamp();
  
  SELECT refreshed_at INTO last_refresh 
  FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  ORDER BY refreshed_at DESC 
  LIMIT 1;
  
  IF last_refresh IS NULL THEN
    refresh_from := now() - interval '1 hour';
  ELSE
    refresh_from := last_refresh - interval '15 minutes';
  END IF;
  
  DELETE FROM public.candles_1min 
  WHERE bucket >= date_trunc('minute', refresh_from);
  
  INSERT INTO public.candles_1min (symbol, venue, bucket, open, high, low, close, volume, trade_count)
  SELECT 
    symbol, venue, date_trunc('minute', trade_time) AS bucket,
    (array_agg(price ORDER BY trade_time))[1] AS open,
    max(price) AS high, min(price) AS low,
    (array_agg(price ORDER BY trade_time DESC))[1] AS close,
    sum(quantity) AS volume, count(*) AS trade_count
  FROM public.trades_normalized
  WHERE trade_time >= refresh_from
  GROUP BY symbol, venue, date_trunc('minute', trade_time)
  ON CONFLICT (symbol, venue, bucket) DO UPDATE SET
    open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
    close = EXCLUDED.close, volume = EXCLUDED.volume, trade_count = EXCLUDED.trade_count;
  
  -- Update daily_stats (IO optimization)
  INSERT INTO public.daily_stats (date, total_trades, unique_symbols, unique_venues, last_updated)
  SELECT current_date, COUNT(*), COUNT(DISTINCT symbol), COUNT(DISTINCT venue), now()
  FROM public.trades_normalized WHERE trade_time >= current_date
  ON CONFLICT (date) DO UPDATE SET
    total_trades = EXCLUDED.total_trades, unique_symbols = EXCLUDED.unique_symbols,
    unique_venues = EXCLUDED.unique_venues, last_updated = EXCLUDED.last_updated;
  
  end_ts := clock_timestamp();
  
  SELECT reltuples::bigint INTO row_count FROM pg_class WHERE relname = 'candles_1min';
  
  INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES ('candles_1min', now(), EXTRACT(MILLISECONDS FROM (end_ts - start_ts))::integer, COALESCE(row_count, 0));
  
  DELETE FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  AND id NOT IN (SELECT id FROM public.mv_refresh_log WHERE view_name = 'candles_1min' ORDER BY refreshed_at DESC LIMIT 100);
END;
$function$;