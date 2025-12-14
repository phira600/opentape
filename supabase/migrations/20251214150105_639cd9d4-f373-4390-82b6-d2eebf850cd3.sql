-- Fix function search path issues
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.candles_1min;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.cleanup_old_trades()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.trades_normalized
  WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM public.activity_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_latest_prices()
RETURNS TABLE(trade_symbol TEXT, trade_venue TEXT, trade_price NUMERIC, trade_timestamp TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (t.symbol, t.venue)
    t.symbol,
    t.venue,
    t.price,
    t.trade_time
  FROM public.trades_normalized t
  ORDER BY t.symbol, t.venue, t.trade_time DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_chart_data(
  p_symbol TEXT,
  p_venue TEXT DEFAULT NULL,
  p_start_time TIMESTAMPTZ DEFAULT NOW() - INTERVAL '24 hours',
  p_end_time TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(bucket TIMESTAMPTZ, open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT c.bucket, c.open, c.high, c.low, c.close, c.volume
  FROM public.candles_1min c
  WHERE c.symbol = p_symbol
    AND (p_venue IS NULL OR c.venue = p_venue)
    AND c.bucket >= p_start_time
    AND c.bucket <= p_end_time
  ORDER BY c.bucket ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Revoke API access to materialized view (only access via RPC)
REVOKE ALL ON public.candles_1min FROM anon, authenticated;