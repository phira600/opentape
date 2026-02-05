import { createClient } from 'npm:@supabase/supabase-js@2'

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
    // Check if job is enabled and get retention settings
    const { data: config, error: configError } = await supabase
      .from('cron_job_configurations')
      .select('is_enabled, retention_days')
      .eq('id', 'cleanup-old-processed-files')
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
    
    console.log(`Starting cleanup of processed files older than ${retentionDays} days (before ${cutoffDate.toISOString()})...`)

    // Log start to activity_logs (with unique message for this job)
    await supabase.from('activity_logs').insert({
      job_id: null,
      log_type: 'info',
      message: `Starting cleanup of processed files older than ${retentionDays} days`,
      details: { retention_days: retentionDays, cutoff_date: cutoffDate.toISOString() }
    })

    // Delete old processed files directly (smaller table, no batching needed)
    const { error: deleteError, count } = await supabase
      .from('processed_files')
      .delete({ count: 'exact' })
      .lt('processed_at', cutoffDate.toISOString())

    if (deleteError) {
      throw new Error(`Delete failed: ${deleteError.message}`)
    }

    const deletedCount = count || 0
    console.log(`Cleanup complete. Deleted ${deletedCount} processed file records.`)

    // Update cron job configuration with success status
    await supabase
      .from('cron_job_configurations')
      .update({
        last_run_at: new Date().toISOString(),
        last_status: 'success',
        last_error: null
      })
      .eq('id', 'cleanup-old-processed-files')

    // Log success to activity_logs
    await supabase.from('activity_logs').insert({
      job_id: null,
      log_type: 'success',
      message: `Cleanup complete: ${deletedCount.toLocaleString()} processed files deleted`,
      details: { 
        deleted_count: deletedCount, 
        retention_days: retentionDays
      }
    })

    const message = deletedCount > 0
      ? `Cleanup complete. Deleted ${deletedCount.toLocaleString()} processed file records.`
      : 'No old processed files to clean up.'

    return new Response(
      JSON.stringify({ 
        success: true, 
        deleted_count: deletedCount,
        retention_days: retentionDays,
        message
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Cleanup error: ${errorMessage}`)

    // Log error to activity_logs
    try {
      await supabase.from('activity_logs').insert({
        job_id: null,
        log_type: 'error',
        message: `Processed files cleanup failed: ${errorMessage}`,
        details: { error: errorMessage }
      })
    } catch (logError) {
      console.error('Failed to log error:', logError)
    }

    // Update error status in configuration
    try {
      await supabase
        .from('cron_job_configurations')
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'error',
          last_error: errorMessage
        })
        .eq('id', 'cleanup-old-processed-files')
    } catch (updateError) {
      console.error('Failed to update error status:', updateError)
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
