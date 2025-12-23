import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const startTime = Date.now()

  try {
    console.log('Starting candles refresh...')

    // Call the refresh_candles function
    const { error } = await supabase.rpc('refresh_candles')

    if (error) {
      throw new Error(`Refresh failed: ${error.message}`)
    }

    const duration = Date.now() - startTime
    console.log(`Candles refresh complete in ${duration}ms`)

    // Get the latest refresh log entry
    const { data: logEntry } = await supabase
      .from('mv_refresh_log')
      .select('rows_count, refresh_duration_ms')
      .eq('view_name', 'candles_1min')
      .order('refreshed_at', { ascending: false })
      .limit(1)
      .single()

    // Update cron job configuration
    await supabase
      .from('cron_job_configurations')
      .update({
        last_run_at: new Date().toISOString(),
        last_status: 'success',
        last_error: null
      })
      .eq('id', 'refresh-candles')

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        rows_count: logEntry?.rows_count || 0,
        message: `Candles refreshed successfully (${logEntry?.rows_count || 0} rows)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Candles refresh error: ${errorMessage}`)

    // Update cron job configuration with error
    await supabase
      .from('cron_job_configurations')
      .update({
        last_run_at: new Date().toISOString(),
        last_status: 'error',
        last_error: errorMessage
      })
      .eq('id', 'refresh-candles')

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
