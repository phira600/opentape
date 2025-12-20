-- Create API key IP whitelist table
CREATE TABLE public.api_key_ip_whitelist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE CASCADE NOT NULL,
  ip_address text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (api_key_id, ip_address)
);

-- Enable RLS
ALTER TABLE public.api_key_ip_whitelist ENABLE ROW LEVEL SECURITY;

-- Users can view their own IP whitelist entries
CREATE POLICY "Users can view own IP whitelist"
  ON public.api_key_ip_whitelist FOR SELECT
  USING (api_key_id IN (SELECT id FROM public.api_keys WHERE user_id = auth.uid()));

-- Users can insert IP whitelist entries for their own API keys
CREATE POLICY "Users can insert own IP whitelist"
  ON public.api_key_ip_whitelist FOR INSERT
  WITH CHECK (api_key_id IN (SELECT id FROM public.api_keys WHERE user_id = auth.uid()));

-- Users can delete their own IP whitelist entries
CREATE POLICY "Users can delete own IP whitelist"
  ON public.api_key_ip_whitelist FOR DELETE
  USING (api_key_id IN (SELECT id FROM public.api_keys WHERE user_id = auth.uid()));

-- Service role full access
CREATE POLICY "Service role full access to ip_whitelist"
  ON public.api_key_ip_whitelist FOR ALL
  USING (true)
  WITH CHECK (true);