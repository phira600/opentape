-- Index for filtering trades by time (most important for incremental refresh)
CREATE INDEX IF NOT EXISTS idx_trades_normalized_trade_time 
ON public.trades_normalized (trade_time DESC);

-- Composite index for the GROUP BY operation
CREATE INDEX IF NOT EXISTS idx_trades_normalized_symbol_venue_time 
ON public.trades_normalized (symbol, venue, trade_time);

-- Index for candles deletion by bucket (already has primary key but explicit index helps)
CREATE INDEX IF NOT EXISTS idx_candles_1min_bucket 
ON public.candles_1min (bucket DESC);