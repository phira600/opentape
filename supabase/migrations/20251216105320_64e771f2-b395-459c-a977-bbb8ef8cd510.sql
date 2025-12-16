-- Create table to track materialized view refresh logs
CREATE TABLE public.mv_refresh_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  view_name text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  refresh_duration_ms integer,
  rows_count integer
);

-- Create index for efficient lookups
CREATE INDEX idx_mv_refresh_log_view_name ON public.mv_refresh_log(view_name, refreshed_at DESC);

-- Enable RLS
ALTER TABLE public.mv_refresh_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view refresh logs
CREATE POLICY "Authenticated users can view mv_refresh_log"
ON public.mv_refresh_log
FOR SELECT
USING (true);

-- Allow service role full access
CREATE POLICY "Service role full access to mv_refresh_log"
ON public.mv_refresh_log
FOR ALL
USING (true)
WITH CHECK (true);

-- Update the refresh_candles function to log refresh events
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  start_ts timestamptz;
  end_ts timestamptz;
  row_count integer;
BEGIN
  start_ts := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.candles_1min;
  end_ts := clock_timestamp();
  
  -- Get row count
  SELECT count(*) INTO row_count FROM public.candles_1min;
  
  -- Log the refresh
  INSERT INTO public.mv_refresh_log (view_name, refreshed_at, refresh_duration_ms, rows_count)
  VALUES ('candles_1min', now(), EXTRACT(MILLISECONDS FROM (end_ts - start_ts))::integer, row_count);
  
  -- Keep only last 100 entries to prevent table bloat
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