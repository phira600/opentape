import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 20000  // Delete 20k rows per batch (increased for faster cleanup)
const MAX_BATCHES = 150   // Max 150 batches per run (3M rows max per invocation)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Check if job is enabled and get retention settings
    const { data: config, error: configError } = await supabase
      .from('cron_job_configurations')
      .select('is_enabled, retention_days')
      .eq('id', 'cleanup-old-trades')
      .single()

    if (configError) {
      console.log(`Config error: ${configError.message}`)
    }

    if (!config?.is_enabled) {
      console.log('Cleanup job is disabled, skipping execution')
      return new Response(
        JSON.stringify({ success: true, message: 'Job is disabled', deleted_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const retentionDays = config?.retention_days || 30
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    
    console.log(`Starting batched cleanup of trades older than ${retentionDays} days (before ${cutoffDate.toISOString()})...`)

    let totalDeleted = 0
    let batchCount = 0
    let lastBatchCount = 0

    // Delete in batches to avoid timeouts
    while (batchCount < MAX_BATCHES) {
      const { data, error } = await supabase.rpc('cleanup_old_trades_batch', {
        cutoff_date: cutoffDate.toISOString(),
        batch_size: BATCH_SIZE
      })

      if (error) {
        throw new Error(`Batch ${batchCount + 1} failed: ${error.message}`)
      }

      const deletedCount = data || 0
      lastBatchCount = deletedCount
      totalDeleted += deletedCount
      batchCount++

      console.log(`Batch ${batchCount}: Deleted ${deletedCount} trades (total: ${totalDeleted})`)

      // If we deleted less than batch size, we're done
      if (deletedCount < BATCH_SIZE) {
        break
      }
    }

    // Check if we hit the limit (more work may remain)
    const hitLimit = batchCount >= MAX_BATCHES && lastBatchCount === BATCH_SIZE

    // Get remaining count of old trades
    let remainingCount = 0
    if (hitLimit || totalDeleted > 0) {
      const { count, error: countError } = await supabase
        .from('trades_normalized')
        .select('*', { count: 'exact', head: true })
        .lt('trade_time', cutoffDate.toISOString())
      
      if (!countError) {
        remainingCount = count || 0
      }
    }

    console.log(`Cleanup complete. Deleted ${totalDeleted} trades in ${batchCount} batches. Remaining: ${remainingCount}`)

    // Only refresh candles if we actually deleted something
    if (totalDeleted > 0) {
      console.log('Refreshing candles materialized view...')
      await supabase.rpc('refresh_candles')
    }

    // Update cron job configuration with success status
    await supabase
      .from('cron_job_configurations')
      .update({
        last_run_at: new Date().toISOString(),
        last_status: 'success',
        last_error: null
      })
      .eq('id', 'cleanup-old-trades')

    const message = hitLimit
      ? `Deleted ${totalDeleted.toLocaleString()} trades. ${remainingCount.toLocaleString()} remaining - run again to continue.`
      : totalDeleted > 0
        ? `Cleanup complete. Deleted ${totalDeleted.toLocaleString()} trades.`
        : 'No old trades to clean up.'

    return new Response(
      JSON.stringify({ 
        success: true, 
        deleted_count: totalDeleted,
        remaining_count: remainingCount,
        hit_limit: hitLimit,
        batches: batchCount,
        retention_days: retentionDays,
        message
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Cleanup error: ${errorMessage}`)

    // Update error status in configuration
    try {
      await supabase
        .from('cron_job_configurations')
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'error',
          last_error: errorMessage
        })
        .eq('id', 'cleanup-old-trades')
    } catch (updateError) {
      console.error('Failed to update error status:', updateError)
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})