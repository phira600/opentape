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
    // First check if we have trade data to process
    const { data: tradeStats, error: statsError } = await supabase
      .from('trades_normalized')
      .select('id', { count: 'exact', head: true })
    
    const tradeCount = tradeStats ? (statsError ? 0 : (await supabase.from('trades_normalized').select('*', { count: 'exact', head: true })).count || 0) : 0
    
    // Get actual count
    const { count: actualCount } = await supabase
      .from('trades_normalized')
      .select('*', { count: 'exact', head: true })
    
    console.log(`Trade count in database: ${actualCount || 0}`)
    
    if (!actualCount || actualCount === 0) {
      console.log('No trade data available - skipping refresh')
      
      await supabase
        .from('cron_job_configurations')
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'skipped',
          last_error: 'No trade data available'
        })
        .eq('id', 'refresh-candles')

      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'no_trade_data',
          message: 'No trade data available to refresh candles'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Starting candles refresh with ${actualCount} trades...`)

    // Call the refresh_candles function
    const { error } = await supabase.rpc('refresh_candles')

    if (error) {
      // Check if it's a timeout error
      const isTimeout = error.message?.includes('statement timeout') || 
                        error.message?.includes('canceling statement')
      
      if (isTimeout) {
        console.warn(`Refresh timeout after ${Date.now() - startTime}ms - database may be under heavy load or trade volume too high`)
        
        await supabase
          .from('cron_job_configurations')
          .update({
            last_run_at: new Date().toISOString(),
            last_status: 'timeout',
            last_error: `Query timeout after ${Date.now() - startTime}ms. Trade count: ${actualCount}. Consider reducing data retention or optimizing the query.`
          })
          .eq('id', 'refresh-candles')

        return new Response(
          JSON.stringify({
            success: false,
            error_type: 'timeout',
            duration_ms: Date.now() - startTime,
            trade_count: actualCount,
            message: 'Candle refresh timed out - database under heavy load or too much data to process'
          }),
          { status: 408, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
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
        trade_count: actualCount,
        message: `Candles refreshed successfully (${logEntry?.rows_count || 0} rows from ${actualCount} trades)`
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
