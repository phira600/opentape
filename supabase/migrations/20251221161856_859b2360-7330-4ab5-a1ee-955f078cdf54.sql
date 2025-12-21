-- Create invitations table for invite-only user management
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Only admins can view invitations
CREATE POLICY "Admins can view invitations"
  ON public.invitations FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Only admins can create invitations
CREATE POLICY "Admins can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Only admins can delete invitations
CREATE POLICY "Admins can delete invitations"
  ON public.invitations FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- Only admins can update invitations
CREATE POLICY "Admins can update invitations"
  ON public.invitations FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- Service role full access
CREATE POLICY "Service role full access to invitations"
  ON public.invitations FOR ALL
  USING (true)
  WITH CHECK (true);