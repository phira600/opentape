-- Drop and recreate the refresh_candles function with true incremental processing
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  started_at timestamptz;
  finished_at timestamptz;
  last_processed_time timestamptz;
  max_trade_time timestamptz;
  process_from timestamptz;
  process_to timestamptz;
  batch_start timestamptz;
  batch_end timestamptz;
  batch_rows integer;
  total_rows integer := 0;
  batch_size interval := interval '15 minutes';
BEGIN
  started_at := clock_timestamp();

  -- Set a reasonable statement timeout for each batch
  PERFORM set_config('statement_timeout', '30s', true);

  -- Get the last successfully processed trade time from our log
  SELECT 
    COALESCE(
      (SELECT MAX(t.trade_time) FROM trades_normalized t WHERE t.trade_time <= l.refreshed_at),
      l.refreshed_at - interval '5 minutes'
    )
  INTO last_processed_time
  FROM mv_refresh_log l
  WHERE l.view_name = 'candles_1min'
  ORDER BY l.refreshed_at DESC
  LIMIT 1;

  -- Get the newest trade in the database
  SELECT MAX(trade_time) INTO max_trade_time
  FROM trades_normalized;

  -- No trades at all
  IF max_trade_time IS NULL THEN
    INSERT INTO mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
    VALUES ('candles_1min', now(), 0, 0);
    RETURN;
  END IF;

  -- Determine start point: 5 minutes before last processed time (for backdated trades)
  -- If never processed, only do last 1 hour to bootstrap quickly
  IF last_processed_time IS NULL THEN
    process_from := max_trade_time - interval '1 hour';
  ELSE
    process_from := last_processed_time - interval '5 minutes';
  END IF;

  -- Round down to minute boundary
  process_from := date_trunc('minute', process_from);
  process_to := max_trade_time + interval '1 minute';

  -- Nothing new to process
  IF process_from >= process_to THEN
    INSERT INTO mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
    VALUES ('candles_1min', now(), EXTRACT(MILLISECONDS FROM (clock_timestamp() - started_at))::integer, 0);
    RETURN;
  END IF;

  -- Process in small batches to avoid timeouts
  batch_start := process_from;
  
  WHILE batch_start < process_to LOOP
    batch_end := LEAST(batch_start + batch_size, process_to);

    -- Delete only the affected buckets in this batch
    DELETE FROM candles_1min
    WHERE bucket >= batch_start AND bucket < batch_end;

    -- Insert/update candles for this batch
    INSERT INTO candles_1min (symbol, currency, bucket, open, high, low, close, volume, trade_count)
    SELECT
      t.symbol,
      COALESCE(t.currency, s.currency, 'SEK') AS currency,
      date_trunc('minute', t.trade_time) AS bucket,
      (array_agg(t.price ORDER BY t.trade_time))[1] AS open,
      MAX(t.price) AS high,
      MIN(t.price) AS low,
      (array_agg(t.price ORDER BY t.trade_time DESC))[1] AS close,
      SUM(t.quantity) AS volume,
      COUNT(*) AS trade_count
    FROM trades_normalized t
    LEFT JOIN LATERAL (
      SELECT currency FROM symbology WHERE isin = t.symbol AND currency IS NOT NULL LIMIT 1
    ) s ON true
    WHERE t.trade_time >= batch_start AND t.trade_time < batch_end
    GROUP BY t.symbol, COALESCE(t.currency, s.currency, 'SEK'), date_trunc('minute', t.trade_time)
    ON CONFLICT (symbol, currency, bucket) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      trade_count = EXCLUDED.trade_count;

    GET DIAGNOSTICS batch_rows = ROW_COUNT;
    total_rows := total_rows + COALESCE(batch_rows, 0);

    batch_start := batch_end;
  END LOOP;

  -- Update daily_stats only for affected dates (fast)
  INSERT INTO daily_stats (date, total_trades, unique_symbols, unique_venues, last_updated)
  SELECT 
    date_trunc('day', trade_time)::date,
    COUNT(*),
    COUNT(DISTINCT symbol),
    COUNT(DISTINCT venue),
    now()
  FROM trades_normalized
  WHERE trade_time >= process_from
  GROUP BY date_trunc('day', trade_time)::date
  ON CONFLICT (date) DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    unique_symbols = EXCLUDED.unique_symbols,
    unique_venues = EXCLUDED.unique_venues,
    last_updated = EXCLUDED.last_updated;

  finished_at := clock_timestamp();

  -- Log this refresh with the actual time range processed
  INSERT INTO mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES (
    'candles_1min',
    process_to,
    EXTRACT(MILLISECONDS FROM (finished_at - started_at))::integer,
    total_rows
  );

  -- Keep only last 100 refresh logs
  DELETE FROM mv_refresh_log
  WHERE view_name = 'candles_1min'
    AND id NOT IN (
      SELECT id FROM mv_refresh_log
      WHERE view_name = 'candles_1min'
      ORDER BY refreshed_at DESC
      LIMIT 100
    );
END;
$function$;

-- Create a composite index for the batch query pattern
CREATE INDEX IF NOT EXISTS idx_trades_normalized_time_symbol_batch 
ON trades_normalized (trade_time, symbol, currency);

-- Ensure we have an index on symbology for the lateral join
CREATE INDEX IF NOT EXISTS idx_symbology_isin_currency 
ON symbology (isin) WHERE currency IS NOT NULL;