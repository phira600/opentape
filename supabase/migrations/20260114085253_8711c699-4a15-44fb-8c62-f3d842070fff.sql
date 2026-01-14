-- Create batch deletion function for activity_logs
CREATE OR REPLACE FUNCTION public.cleanup_old_activity_logs_batch(
  cutoff_date timestamp with time zone, 
  batch_size integer DEFAULT 20000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM activity_logs
    WHERE ctid IN (
      SELECT ctid FROM activity_logs
      WHERE created_at < cutoff_date
      LIMIT batch_size
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$;

-- Insert configuration entries for the new cleanup jobs
INSERT INTO cron_job_configurations (id, name, schedule, is_enabled, retention_days, description)
VALUES 
  ('cleanup-old-activity-logs', 'Cleanup Old Activity Logs', '0 */2 * * *', true, 30, 'Removes activity logs older than retention period'),
  ('cleanup-old-processed-files', 'Cleanup Old Processed Files', '0 */2 * * *', true, 30, 'Removes processed file records older than retention period')
ON CONFLICT (id) DO NOTHING;