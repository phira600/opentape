-- Rename cleanup tasks from "Cleanup Old xxx" to "xxx Cleanup"
UPDATE cron_job_configurations 
SET name = 'Trades Cleanup', updated_at = now()
WHERE id = 'cleanup-old-trades';

UPDATE cron_job_configurations 
SET name = 'Candles Cleanup', updated_at = now()
WHERE id = 'cleanup-old-candles';

UPDATE cron_job_configurations 
SET name = 'Activity Logs Cleanup', updated_at = now()
WHERE id = 'cleanup-old-activity-logs';

UPDATE cron_job_configurations 
SET name = 'Processed Files Cleanup', updated_at = now()
WHERE id = 'cleanup-old-processed-files';