-- Create job_configurations table for managing data sources
CREATE TABLE public.job_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('cboe', 'lseg', 'custom')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  fetch_interval_seconds INTEGER NOT NULL DEFAULT 60,
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_status TEXT CHECK (last_status IN ('success', 'error', 'running', 'pending')),
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create processed_files table to track already processed files
CREATE TABLE public.processed_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.job_configurations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  records_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(job_id, file_hash)
);

-- Create trades_normalized table for storing parsed trade data
CREATE TABLE public.trades_normalized (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.job_configurations(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  price NUMERIC(20, 8) NOT NULL,
  quantity NUMERIC(20, 8) NOT NULL,
  trade_time TIMESTAMP WITH TIME ZONE NOT NULL,
  venue TEXT NOT NULL,
  market_mechanism TEXT,
  trading_mode TEXT,
  transaction_id TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create activity_logs table for tracking job execution
CREATE TABLE public.activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.job_configurations(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL CHECK (log_type IN ('info', 'warning', 'error', 'success')),
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_trades_symbol_timestamp ON public.trades_normalized(symbol, trade_time DESC);
CREATE INDEX idx_trades_venue ON public.trades_normalized(venue);
CREATE INDEX idx_trades_market_mechanism ON public.trades_normalized(market_mechanism);
CREATE INDEX idx_trades_created_at ON public.trades_normalized(created_at);
CREATE INDEX idx_processed_files_job_id ON public.processed_files(job_id);
CREATE INDEX idx_activity_logs_job_id ON public.activity_logs(job_id);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs(created_at DESC);

-- Create materialized view for 1-minute candles
CREATE MATERIALIZED VIEW public.candles_1min AS
SELECT
  symbol,
  venue,
  date_trunc('minute', trade_time) AS bucket,
  (array_agg(price ORDER BY trade_time ASC))[1] AS open,
  MAX(price) AS high,
  MIN(price) AS low,
  (array_agg(price ORDER BY trade_time DESC))[1] AS close,
  SUM(quantity) AS volume,
  COUNT(*) AS trade_count
FROM public.trades_normalized
GROUP BY symbol, venue, date_trunc('minute', trade_time);

CREATE UNIQUE INDEX idx_candles_1min_unique ON public.candles_1min(symbol, venue, bucket);
CREATE INDEX idx_candles_1min_bucket ON public.candles_1min(bucket DESC);

-- Enable RLS on all tables
ALTER TABLE public.job_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades_normalized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users (admin access)
CREATE POLICY "Authenticated users can view job_configurations"
ON public.job_configurations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage job_configurations"
ON public.job_configurations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view processed_files"
ON public.processed_files FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage processed_files"
ON public.processed_files FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view trades"
ON public.trades_normalized FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert trades"
ON public.trades_normalized FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can view activity_logs"
ON public.activity_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert activity_logs"
ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Service role policies for edge functions
CREATE POLICY "Service role full access to job_configurations"
ON public.job_configurations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to processed_files"
ON public.processed_files FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to trades"
ON public.trades_normalized FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to activity_logs"
ON public.activity_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Function to refresh candles materialized view
CREATE OR REPLACE FUNCTION public.refresh_candles()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.candles_1min;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old trades (30 days retention)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function to get latest prices per symbol
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function to get chart data
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for job_configurations updated_at
CREATE TRIGGER update_job_configurations_updated_at
BEFORE UPDATE ON public.job_configurations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for activity_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;