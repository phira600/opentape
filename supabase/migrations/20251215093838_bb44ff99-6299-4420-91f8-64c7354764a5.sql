-- Create cron job configurations table
CREATE TABLE public.cron_job_configurations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT NOT NULL DEFAULT '0 0 * * *',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_status TEXT,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cron_job_configurations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view cron_job_configurations"
ON public.cron_job_configurations
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can manage cron_job_configurations"
ON public.cron_job_configurations
FOR ALL
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_cron_job_configurations_updated_at
BEFORE UPDATE ON public.cron_job_configurations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default cron jobs
INSERT INTO public.cron_job_configurations (id, name, description, schedule) VALUES
  ('cleanup-old-trades', 'Data Cleanup', 'Removes trades and logs older than 30 days', '0 0 * * *'),
  ('fetch-symbology', 'SIS Symbology Sync', 'Fetches CBOE SIS symbology data daily', '0 6 * * 1-5');