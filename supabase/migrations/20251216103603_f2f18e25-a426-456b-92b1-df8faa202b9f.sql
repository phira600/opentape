-- Grant SELECT permission on candles_1min to authenticated users and service role
GRANT SELECT ON public.candles_1min TO authenticated;
GRANT SELECT ON public.candles_1min TO anon;
GRANT SELECT ON public.candles_1min TO service_role;

-- Also grant refresh permission to service_role for the refresh_candles function
GRANT ALL ON public.candles_1min TO service_role;