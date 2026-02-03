-- Index Consolidation: Drop 8 redundant/unused indexes
-- Expected storage savings: ~5.3 GB

-- Drop redundant and unused indexes
DROP INDEX IF EXISTS idx_trades_normalized_symbol_venue_time;
DROP INDEX IF EXISTS idx_trades_normalized_time_symbol_batch;
DROP INDEX IF EXISTS idx_trades_normalized_trade_time_symbol;
DROP INDEX IF EXISTS idx_trades_cleanup_asc;
DROP INDEX IF EXISTS idx_trades_market_mechanism;
DROP INDEX IF EXISTS idx_trades_normalized_currency;
DROP INDEX IF EXISTS idx_trades_venue;
DROP INDEX IF EXISTS idx_trades_created_at;