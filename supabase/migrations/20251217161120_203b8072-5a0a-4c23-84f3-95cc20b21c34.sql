-- Fix refresh_candles to properly catch up on missed trades
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_ts timestamptz;
  end_ts timestamptz;
  latest_candle timestamptz;
  refresh_from timestamptz;
  row_count integer;
BEGIN
  start_ts := clock_timestamp();
  
  -- Get the latest candle bucket we have
  SELECT MAX(bucket) INTO latest_candle FROM public.candles_1min;
  
  -- If no candles exist, process all of today's data
  -- Otherwise, refresh from the latest candle minus 5 minutes (for overlap safety)
  IF latest_candle IS NULL THEN
    refresh_from := current_date;
  ELSE
    refresh_from := latest_candle - interval '5 minutes';
  END IF;
  
  -- Delete candles that will be refreshed
  DELETE FROM public.candles_1min 
  WHERE bucket >= refresh_from;
  
  -- Aggregate by symbol (ISIN) and currency from trades
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
  
  -- Update daily_stats
  INSERT INTO public.daily_stats (date, total_trades, unique_symbols, unique_venues, last_updated)
  SELECT current_date, COUNT(*), COUNT(DISTINCT symbol), COUNT(DISTINCT venue), now()
  FROM public.trades_normalized WHERE trade_time >= current_date
  ON CONFLICT (date) DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    unique_symbols = EXCLUDED.unique_symbols,
    unique_venues = EXCLUDED.unique_venues,
    last_updated = EXCLUDED.last_updated;
  
  end_ts := clock_timestamp();
  
  GET DIAGNOSTICS row_count = ROW_COUNT;
  
  -- Get actual count from table
  SELECT COUNT(*)::integer INTO row_count FROM public.candles_1min;
  
  INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES ('candles_1min', now(), EXTRACT(MILLISECONDS FROM (end_ts - start_ts))::integer, COALESCE(row_count, 0));
  
  -- Keep only last 100 refresh logs
  DELETE FROM public.mv_refresh_log 
  WHERE view_name = 'candles_1min' 
  AND id NOT IN (SELECT id FROM public.mv_refresh_log WHERE view_name = 'candles_1min' ORDER BY refreshed_at DESC LIMIT 100);
END;
$$;