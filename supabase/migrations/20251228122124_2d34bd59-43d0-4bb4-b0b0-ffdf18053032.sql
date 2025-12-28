-- Drop and recreate the optimized refresh_candles function
CREATE OR REPLACE FUNCTION public.refresh_candles()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  start_ts timestamptz;
  end_ts timestamptz;
  last_refresh_at timestamptz;
  refresh_from timestamptz;
  row_count integer;
  trades_processed integer;
BEGIN
  start_ts := clock_timestamp();
  
  -- Get the last successful refresh time from the log
  SELECT refreshed_at INTO last_refresh_at 
  FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  ORDER BY refreshed_at DESC 
  LIMIT 1;
  
  -- Calculate refresh_from: 5 minutes before last refresh (for backdated trades)
  -- If no previous refresh, start from 24 hours ago to limit initial load
  IF last_refresh_at IS NULL THEN
    refresh_from := now() - interval '24 hours';
    RAISE NOTICE 'No previous refresh found, processing last 24 hours';
  ELSE
    refresh_from := last_refresh_at - interval '5 minutes';
    RAISE NOTICE 'Incremental refresh from %', refresh_from;
  END IF;
  
  -- Count trades to be processed (for logging)
  SELECT COUNT(*) INTO trades_processed
  FROM public.trades_normalized
  WHERE trade_time >= refresh_from;
  
  RAISE NOTICE 'Processing % trades since %', trades_processed, refresh_from;
  
  -- If no trades to process, just log and return
  IF trades_processed = 0 THEN
    INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
    VALUES ('candles_1min', now(), 0, 0);
    RETURN;
  END IF;
  
  -- Delete only the candle buckets that will be refreshed
  DELETE FROM public.candles_1min 
  WHERE bucket >= date_trunc('minute', refresh_from);
  
  -- Aggregate only new/updated trades
  INSERT INTO public.candles_1min (symbol, currency, bucket, open, high, low, close, volume, trade_count)
  SELECT 
    t.symbol,
    COALESCE(t.currency, s.currency, 'SEK') AS currency,
    date_trunc('minute', t.trade_time) AS bucket,
    (array_agg(t.price ORDER BY t.trade_time))[1] AS open,
    max(t.price) AS high,
    min(t.price) AS low,
    (array_agg(t.price ORDER BY t.trade_time DESC))[1] AS close,
    sum(t.quantity) AS volume,
    count(*) AS trade_count
  FROM public.trades_normalized t
  LEFT JOIN (
    SELECT DISTINCT ON (isin) isin, currency 
    FROM public.symbology 
    WHERE currency IS NOT NULL
  ) s ON t.symbol = s.isin
  WHERE t.trade_time >= refresh_from
  GROUP BY t.symbol, COALESCE(t.currency, s.currency, 'SEK'), date_trunc('minute', t.trade_time)
  ON CONFLICT (symbol, currency, bucket) DO UPDATE SET
    open = EXCLUDED.open,
    high = EXCLUDED.high,
    low = EXCLUDED.low,
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    trade_count = EXCLUDED.trade_count;
  
  -- Update daily_stats (only for today to keep it fast)
  INSERT INTO public.daily_stats (date, total_trades, unique_symbols, unique_venues, last_updated)
  SELECT current_date, COUNT(*), COUNT(DISTINCT symbol), COUNT(DISTINCT venue), now()
  FROM public.trades_normalized WHERE trade_time >= current_date
  ON CONFLICT (date) DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    unique_symbols = EXCLUDED.unique_symbols,
    unique_venues = EXCLUDED.unique_venues,
    last_updated = EXCLUDED.last_updated;
  
  end_ts := clock_timestamp();
  
  -- Get count of candles created/updated in this refresh
  GET DIAGNOSTICS row_count = ROW_COUNT;
  
  INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES ('candles_1min', now(), EXTRACT(MILLISECONDS FROM (end_ts - start_ts))::integer, COALESCE(row_count, trades_processed));
  
  RAISE NOTICE 'Refresh complete in % ms, processed % trades', 
    EXTRACT(MILLISECONDS FROM (end_ts - start_ts))::integer, trades_processed;
  
  -- Keep only last 100 refresh logs
  DELETE FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  AND id NOT IN (SELECT id FROM public.mv_refresh_log WHERE view_name = 'candles_1min' ORDER BY refreshed_at DESC LIMIT 100);
END;
$function$;

-- Ensure index exists on trade_time for fast incremental queries
CREATE INDEX IF NOT EXISTS idx_trades_normalized_trade_time ON public.trades_normalized(trade_time DESC);