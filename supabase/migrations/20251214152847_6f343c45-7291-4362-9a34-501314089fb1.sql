-- Create symbology table for storing ticker/symbol reference data
CREATE TABLE public.symbology (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  isin TEXT,
  name TEXT,
  currency TEXT,
  venue TEXT NOT NULL,
  source TEXT NOT NULL,
  mic TEXT,
  segment TEXT,
  tick_table TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_data JSONB,
  UNIQUE(symbol, venue, source)
);

-- Create index for fast lookups
CREATE INDEX idx_symbology_symbol ON public.symbology(symbol);
CREATE INDEX idx_symbology_isin ON public.symbology(isin);
CREATE INDEX idx_symbology_venue ON public.symbology(venue);
CREATE INDEX idx_symbology_source ON public.symbology(source);

-- Enable RLS
ALTER TABLE public.symbology ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view symbology"
ON public.symbology
FOR SELECT
USING (true);

CREATE POLICY "Service role can manage symbology"
ON public.symbology
FOR ALL
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_symbology_updated_at
BEFORE UPDATE ON public.symbology
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();