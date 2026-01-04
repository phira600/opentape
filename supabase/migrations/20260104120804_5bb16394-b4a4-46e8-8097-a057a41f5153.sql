-- Drop the existing constraint
ALTER TABLE public.job_configurations DROP CONSTRAINT IF EXISTS job_configurations_source_type_check;

-- Add updated constraint with new LSEG source types
ALTER TABLE public.job_configurations ADD CONSTRAINT job_configurations_source_type_check 
CHECK (source_type IN ('cboe', 'cboe_bxe', 'cboe_cxe', 'cboe_dxe', 'cboe_sis', 'nasdaq', 'lseg', 'lseg_trqx', 'lseg_tqex', 'lseg_xlon', 'custom'));