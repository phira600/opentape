-- Drop the old constraint that only allows limited status values
ALTER TABLE job_configurations 
DROP CONSTRAINT IF EXISTS job_configurations_last_status_check;

-- Add new constraint with all valid status values including granular statuses
ALTER TABLE job_configurations 
ADD CONSTRAINT job_configurations_last_status_check 
CHECK (last_status IS NULL OR last_status = ANY (ARRAY[
  'success',
  'error', 
  'running',
  'pending',
  'no_files',
  'no_data',
  'partial',
  'skipped',
  'timeout'
]));