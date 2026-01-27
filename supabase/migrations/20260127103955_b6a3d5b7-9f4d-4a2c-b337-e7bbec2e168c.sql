-- Add timezone column to job_configurations for local time scheduling with DST support
ALTER TABLE public.job_configurations
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';

COMMENT ON COLUMN public.job_configurations.timezone IS 
  'IANA timezone (e.g., Europe/London, Europe/Stockholm) for local schedule interpretation with automatic DST handling';

-- Update default schedules for existing jobs
-- CBOE jobs: 08:00-17:00 UK time (Europe/London)
UPDATE public.job_configurations
SET 
  timezone = 'Europe/London',
  run_start_hour = 8,
  run_end_hour = 17
WHERE source_type IN ('cboe_bxe', 'cboe_cxe', 'cboe_dxe');

-- NASDAQ job: 09:00-18:00 CET (Europe/Stockholm)
UPDATE public.job_configurations
SET 
  timezone = 'Europe/Stockholm',
  run_start_hour = 9,
  run_end_hour = 18
WHERE source_type = 'nasdaq';

-- LSEG jobs: Default to Europe/London (UK market)
UPDATE public.job_configurations
SET 
  timezone = 'Europe/London',
  run_start_hour = 8,
  run_end_hour = 17
WHERE source_type IN ('lseg_trqx', 'lseg_tqex', 'lseg_xlon');