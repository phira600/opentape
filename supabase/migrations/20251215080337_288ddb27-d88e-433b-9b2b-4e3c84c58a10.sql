-- Enable required extensions for cron scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing cron job for fetch-trade-files to avoid duplicates
SELECT cron.unschedule('fetch-trade-files-weekdays') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'fetch-trade-files-weekdays'
);