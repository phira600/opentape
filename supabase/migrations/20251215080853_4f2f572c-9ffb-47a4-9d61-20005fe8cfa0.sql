-- Update source_type constraint to include cboe_sis
ALTER TABLE public.job_configurations 
DROP CONSTRAINT job_configurations_source_type_check;

ALTER TABLE public.job_configurations 
ADD CONSTRAINT job_configurations_source_type_check 
CHECK (source_type = ANY (ARRAY['cboe'::text, 'cboe_bxe'::text, 'cboe_cxe'::text, 'cboe_dxe'::text, 'cboe_sis'::text, 'nasdaq'::text, 'lseg'::text, 'custom'::text]));