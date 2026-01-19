-- Add columns for granular job status tracking
ALTER TABLE public.job_configurations
ADD COLUMN IF NOT EXISTS last_result_details jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS next_run_at timestamp with time zone DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.job_configurations.last_result_details IS 'Detailed metrics from last job run: files_found, files_processed, files_empty, trades_parsed, trades_filtered, trades_saved';
COMMENT ON COLUMN public.job_configurations.next_run_at IS 'Calculated next run time based on schedule';