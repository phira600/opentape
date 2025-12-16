-- Drop old function first to allow parameter name change
DROP FUNCTION IF EXISTS public.get_chart_data(text, text, timestamp with time zone, timestamp with time zone);

-- Recreate with currency parameter
CREATE OR REPLACE FUNCTION public.get_chart_data(
  p_symbol text, 
  p_currency text DEFAULT NULL, 
  p_start_time timestamp with time zone DEFAULT (now() - '24:00:00'::interval), 
  p_end_time timestamp with time zone DEFAULT now()
)
RETURNS TABLE(bucket timestamp with time zone, open numeric, high numeric, low numeric, close numeric, volume numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT c.bucket, c.open, c.high, c.low, c.close, c.volume
  FROM public.candles_1min c
  WHERE c.symbol = p_symbol
    AND (p_currency IS NULL OR c.currency = p_currency)
    AND c.bucket >= p_start_time
    AND c.bucket <= p_end_time
  ORDER BY c.bucket ASC;
END;
$$;