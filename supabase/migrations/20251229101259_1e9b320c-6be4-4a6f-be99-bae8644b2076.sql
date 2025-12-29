-- Create wrapper functions for pg_cron operations
-- These allow edge functions to manage cron jobs dynamically

CREATE OR REPLACE FUNCTION public.schedule_cron_job(
  job_name TEXT,
  job_schedule TEXT,
  job_command TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Schedule the cron job using pg_cron
  PERFORM cron.schedule(job_name, job_schedule, job_command);
END;
$$;

CREATE OR REPLACE FUNCTION public.unschedule_cron_job(
  job_name TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Unschedule the cron job if it exists
  PERFORM cron.unschedule(job_name);
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore errors (job might not exist)
    NULL;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.schedule_cron_job(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.unschedule_cron_job(TEXT) TO service_role;