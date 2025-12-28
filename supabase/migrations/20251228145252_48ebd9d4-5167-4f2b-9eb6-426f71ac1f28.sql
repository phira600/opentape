-- Refresh candles incrementally in bounded time windows to avoid statement timeouts

CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  started_at timestamptz;
  finished_at timestamptz;
  last_refresh_at timestamptz;
  refresh_from timestamptz;
  max_trade_time timestamptz;
  window_start timestamptz;
  window_end timestamptz;
  window_rows integer;
  total_rows integer := 0;
  step interval := interval '1 hour';
BEGIN
  started_at := clock_timestamp();

  -- Try to give this function enough time per statement (still bounded by platform limits)
  PERFORM set_config('statement_timeout', '120s', true);

  -- Last refresh log timestamp (best available signal)
  SELECT refreshed_at
    INTO last_refresh_at
  FROM public.mv_refresh_log
  WHERE view_name = 'candles_1min'
  ORDER BY refreshed_at DESC
  LIMIT 1;

  -- Start point: last refresh minus 5 minutes (catch backdated trades)
  -- If we never refreshed, only do the last 24h to avoid massive initial load.
  IF last_refresh_at IS NULL THEN
    refresh_from := now() - interval '24 hours';
  ELSE
    refresh_from := last_refresh_at - interval '5 minutes';
  END IF;

  -- Upper bound: newest trade in the table
  SELECT max(trade_time) INTO max_trade_time
  FROM public.trades_normalized;

  -- No trades at all
  IF max_trade_time IS NULL THEN
    INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
    VALUES ('candles_1min', now(), 0, 0);
    RETURN;
  END IF;

  -- Nothing new to process
  IF max_trade_time < refresh_from THEN
    INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
    VALUES ('candles_1min', now(), 0, 0);
    RETURN;
  END IF;

  window_start := date_trunc('minute', refresh_from);

  WHILE window_start <= max_trade_time LOOP
    window_end := LEAST(window_start + step, max_trade_time + interval '1 minute');

    -- Remove only the affected buckets
    DELETE FROM public.candles_1min
    WHERE bucket >= window_start
      AND bucket < window_end;

    -- Rebuild candles for this window
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
    WHERE t.trade_time >= window_start
      AND t.trade_time < window_end
    GROUP BY t.symbol, COALESCE(t.currency, s.currency, 'SEK'), date_trunc('minute', t.trade_time)
    ON CONFLICT (symbol, currency, bucket) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      trade_count = EXCLUDED.trade_count;

    GET DIAGNOSTICS window_rows = ROW_COUNT;
    total_rows := total_rows + COALESCE(window_rows, 0);

    window_start := window_end;
  END LOOP;

  -- Update daily_stats only for today (fast)
  INSERT INTO public.daily_stats (date, total_trades, unique_symbols, unique_venues, last_updated)
  SELECT current_date, COUNT(*), COUNT(DISTINCT symbol), COUNT(DISTINCT venue), now()
  FROM public.trades_normalized
  WHERE trade_time >= current_date
  ON CONFLICT (date) DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    unique_symbols = EXCLUDED.unique_symbols,
    unique_venues = EXCLUDED.unique_venues,
    last_updated = EXCLUDED.last_updated;

  finished_at := clock_timestamp();

  INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES (
    'candles_1min',
    now(),
    EXTRACT(MILLISECONDS FROM (finished_at - started_at))::integer,
    total_rows
  );

  -- Keep only last 100 refresh logs
  DELETE FROM public.mv_refresh_log
  WHERE view_name = 'candles_1min'
    AND id NOT IN (
      SELECT id
      FROM public.mv_refresh_log
      WHERE view_name = 'candles_1min'
      ORDER BY refreshed_at DESC
      LIMIT 100
    );
END;
$function$;

-- Helpful index for time-window scans
CREATE INDEX IF NOT EXISTS idx_trades_normalized_trade_time ON public.trades_normalized (trade_time DESC);

-- Optional: index to speed up per-symbol aggregation inside windows
CREATE INDEX IF NOT EXISTS idx_trades_normalized_trade_time_symbol ON public.trades_normalized (trade_time DESC, symbol);
