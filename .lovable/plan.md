

# Index Consolidation Plan: 13 to 5 Indexes

## Overview

This migration will drop 8 redundant or low-usage indexes from the `trades_normalized` table, reclaiming approximately **5-6 GB of storage** and improving write performance by reducing the number of indexes updated on each trade insert.

## Current State (13 Indexes)

| Index Name | Size | Usage Count | Purpose |
|------------|------|-------------|---------|
| `idx_trades_normalized_symbol_venue_time` | 1,446 MB | 861 | Symbol+venue+time lookups |
| `idx_trades_symbol_timestamp` | 1,329 MB | 993 | Symbol Explorer queries |
| `idx_trades_normalized_time_symbol_batch` | 1,187 MB | 22,420 | Candle trigger batch lookups |
| `trades_normalized_pkey` | 978 MB | 11,673 | Primary key (required) |
| `idx_trades_normalized_trade_time_symbol` | 953 MB | 117 | **Redundant** - covered by others |
| `idx_trades_cleanup_asc` | 609 MB | 24,335 | Cleanup batch deletes |
| `idx_trades_normalized_trade_time` | 607 MB | 65,536 | Time-based ordering |
| `idx_trades_market_mechanism` | 287 MB | 4 | **Unused** |
| `idx_trades_normalized_currency` | 284 MB | 4 | **Unused** |
| `idx_trades_venue` | 283 MB | 112 | Low usage, optional |
| `idx_trades_date_symbol` | 274 MB | 55M | Daily stats trigger |
| `idx_trades_date_venue` | 249 MB | 55M | Daily stats trigger |
| `idx_trades_created_at` | 206 MB | 10,076 | Legacy, no longer used |

## Target State (5 Indexes)

| Index Name | Size | Supports |
|------------|------|----------|
| `trades_normalized_pkey` | 978 MB | Primary key (required) |
| `idx_trades_symbol_timestamp` | 1,329 MB | Trade Explorer, Symbol queries, candle rebuild |
| `idx_trades_normalized_trade_time` | 607 MB | Cleanup (trade_time < cutoff), ordering |
| `idx_trades_date_symbol` | 274 MB | Daily stats trigger (symbol uniqueness check) |
| `idx_trades_date_venue` | 249 MB | Daily stats trigger (venue uniqueness check) |

**Total after cleanup**: ~3.4 GB indexes (down from ~8.7 GB)

## Indexes to Drop (8)

| Index | Size | Reason for Removal |
|-------|------|-------------------|
| `idx_trades_normalized_symbol_venue_time` | 1,446 MB | Low usage (861 scans), overlaps with symbol+time index |
| `idx_trades_normalized_time_symbol_batch` | 1,187 MB | Covered by `idx_trades_symbol_timestamp` for candle queries |
| `idx_trades_normalized_trade_time_symbol` | 953 MB | Only 117 uses, fully redundant |
| `idx_trades_cleanup_asc` | 609 MB | DESC index works for cleanup with slight plan change |
| `idx_trades_market_mechanism` | 287 MB | Only 4 uses, not filtered in queries |
| `idx_trades_normalized_currency` | 284 MB | Only 4 uses, not filtered in queries |
| `idx_trades_venue` | 283 MB | Only 112 uses, venue filtering is rare |
| `idx_trades_created_at` | 206 MB | Legacy column, cleanup uses trade_time |

**Storage reclaimed**: ~5.3 GB

## Implementation

### Database Migration

A single migration will drop the 8 unused indexes in one transaction:

```sql
-- Drop redundant and unused indexes
DROP INDEX IF EXISTS idx_trades_normalized_symbol_venue_time;
DROP INDEX IF EXISTS idx_trades_normalized_time_symbol_batch;
DROP INDEX IF EXISTS idx_trades_normalized_trade_time_symbol;
DROP INDEX IF EXISTS idx_trades_cleanup_asc;
DROP INDEX IF EXISTS idx_trades_market_mechanism;
DROP INDEX IF EXISTS idx_trades_normalized_currency;
DROP INDEX IF EXISTS idx_trades_venue;
DROP INDEX IF EXISTS idx_trades_created_at;
```

### Post-Migration (Optional)

After the migration, running `VACUUM ANALYZE trades_normalized` will update table statistics and reclaim any additional dead space. This happens automatically over time but can be expedited.

## Query Coverage Analysis

| Query Pattern | Before | After (covered by) |
|---------------|--------|-------------------|
| Trade Explorer: `ORDER BY trade_time DESC` | `idx_trades_normalized_trade_time` | `idx_trades_normalized_trade_time` |
| Trade Explorer: `WHERE symbol ILIKE x` | `idx_trades_symbol_timestamp` | `idx_trades_symbol_timestamp` |
| Cleanup: `WHERE trade_time < cutoff` | `idx_trades_cleanup_asc` | `idx_trades_normalized_trade_time` (DESC works) |
| Candle rebuild: `WHERE trade_time >= x AND < y ORDER BY trade_time ASC` | Multiple indexes | `idx_trades_normalized_trade_time` |
| Daily stats: symbol uniqueness | `idx_trades_date_symbol` | `idx_trades_date_symbol` |
| Daily stats: venue uniqueness | `idx_trades_date_venue` | `idx_trades_date_venue` |

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Total index size | 8.7 GB | ~3.4 GB |
| Index count | 13 | 5 |
| Write overhead per trade | 13 index updates | 5 index updates |
| Storage reclaimed | - | ~5.3 GB |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Query performance regression | All active query patterns remain covered by retained indexes |
| Cleanup job slower | DESC index can scan backwards; impact minimal for ctid batches |
| Venue filtering in Trade Explorer | Rare use case; full scan on filtered subset is acceptable |

