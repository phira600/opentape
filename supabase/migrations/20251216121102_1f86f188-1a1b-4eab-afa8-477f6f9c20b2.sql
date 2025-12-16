-- Add schedule configuration to job_configurations
ALTER TABLE public.job_configurations
ADD COLUMN IF NOT EXISTS run_days text[] DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri'],
ADD COLUMN IF NOT EXISTS run_start_hour integer DEFAULT 6,
ADD COLUMN IF NOT EXISTS run_end_hour integer DEFAULT 21;

-- Add retention_days to cron_job_configurations for cleanup jobs
ALTER TABLE public.cron_job_configurations
ADD COLUMN IF NOT EXISTS retention_days integer DEFAULT 30;

-- Update existing job_configurations with defaults
UPDATE public.job_configurations 
SET run_days = ARRAY['mon', 'tue', 'wed', 'thu', 'fri'],
    run_start_hour = 6,
    run_end_hour = 21
WHERE run_days IS NULL;

-- Insert/update cron job configurations for existing jobs
INSERT INTO public.cron_job_configurations (id, name, description, schedule, is_enabled, retention_days)
VALUES 
  ('cleanup-old-trades', 'Cleanup Old Trades', 'Removes trades older than retention period', '0 2 * * *', true, 30),
  ('refresh-candles', 'Refresh Candles', 'Refreshes 1-minute candle aggregations', '*/5 * * * *', true, NULL),
  ('cboe-sis-symbology', 'CBOE SIS Symbology', 'Fetches symbol listings from CBOE SIS', '0 8 * * 1-5', true, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;