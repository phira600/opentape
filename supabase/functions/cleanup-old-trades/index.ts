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

  try {
    // Get retention days from configuration
    const { data: config, error: configError } = await supabase
      .from('cron_job_configurations')
      .select('retention_days')
      .eq('id', 'cleanup-old-trades')
      .single()

    const retentionDays = config?.retention_days || 30
    console.log(`Starting cleanup of trades older than ${retentionDays} days...`)

    // Call the cleanup function with retention days
    const { data, error } = await supabase.rpc('cleanup_old_trades', {
      retention_days: retentionDays
    })

    if (error) {
      throw new Error(`Cleanup failed: ${error.message}`)
    }

    const deletedCount = data || 0
    console.log(`Cleanup complete. Deleted ${deletedCount} trades.`)

    // Refresh the materialized view after cleanup
    await supabase.rpc('refresh_candles')

    return new Response(
      JSON.stringify({ 
        success: true, 
        deleted_count: deletedCount,
        retention_days: retentionDays,
        message: `Deleted ${deletedCount} trades older than ${retentionDays} days` 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Cleanup error: ${errorMessage}`)

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
