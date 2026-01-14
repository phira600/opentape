-- Drop the obsolete mv_refresh_log table
-- This table was used to track materialized view refreshes, but the refresh_candles() function has been dropped
-- and all relevant logging now goes to activity_logs
DROP TABLE IF EXISTS public.mv_refresh_log;