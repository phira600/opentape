import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CronJobDefinition {
  name: string
  schedule: string
  function_name: string
  description: string
}

const CRON_JOBS: CronJobDefinition[] = [
  {
    name: 'fetch-trade-files-weekdays',
    schedule: '* * * * 1-5', // Every minute on weekdays
    function_name: 'fetch-trade-files',
    description: 'Fetches trade files from all enabled data sources'
  },
  {
    name: 'cleanup-old-trades-daily',
    schedule: '0 0 * * *', // Daily at midnight
    function_name: 'cleanup-old-trades',
    description: 'Cleans up old trades based on retention settings'
  },
  {
    name: 'recreate-candles-daily',
    schedule: '0 3 * * *', // Daily at 3 AM UTC
    function_name: 'refresh-candles',
    description: 'Recreates 1-minute candles from historical trade data for a configurable date range (default: T-7 to T-1)'
  },
  {
    name: 'cboe-sis-symbology-daily',
    schedule: '0 8 * * 1-5', // 8 AM UTC on weekdays
    function_name: 'fetch-symbology',
    description: 'Fetches symbol listings from CBOE SIS'
  }
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    console.log('Provisioning cron jobs...')
    console.log(`Supabase URL: ${supabaseUrl}`)

    const results: { name: string; status: string; error?: string }[] = []

    for (const job of CRON_JOBS) {
      try {
        // First, try to unschedule any existing job with this name
        const { error: unscheduleError } = await supabase.rpc('unschedule_cron_job', {
          job_name: job.name
        }).maybeSingle()
        
        // Ignore errors from unschedule (job might not exist)
        if (unscheduleError) {
          console.log(`Note: Could not unschedule ${job.name} (may not exist): ${unscheduleError.message}`)
        }

        // Build the HTTP POST command for pg_cron
        // Include appropriate body for each function type
        const functionUrl = `${supabaseUrl}/functions/v1/${job.function_name}`
        let bodyJson = '{}'
        if (job.function_name === 'refresh-candles') {
          // Historical mode: recreate candles for T-7 to T-1
          bodyJson = '{"update_status": true, "days_back": 7}'
        }
        const cronCommand = `
          SELECT net.http_post(
            url := '${functionUrl}',
            headers := '{"Content-Type": "application/json", "Authorization": "Bearer ${supabaseAnonKey}"}'::jsonb,
            body := '${bodyJson}'::jsonb
          ) AS request_id;
        `

        // Schedule the new cron job
        const { error: scheduleError } = await supabase.rpc('schedule_cron_job', {
          job_name: job.name,
          job_schedule: job.schedule,
          job_command: cronCommand
        })

        if (scheduleError) {
          console.error(`Failed to schedule ${job.name}: ${scheduleError.message}`)
          results.push({ name: job.name, status: 'error', error: scheduleError.message })
        } else {
          console.log(`Successfully scheduled ${job.name}`)
          results.push({ name: job.name, status: 'created' })
        }
      } catch (jobError) {
        const errorMsg = jobError instanceof Error ? jobError.message : 'Unknown error'
        console.error(`Error processing ${job.name}: ${errorMsg}`)
        results.push({ name: job.name, status: 'error', error: errorMsg })
      }
    }

    // Log the provisioning
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Provisioned ${results.filter(r => r.status === 'created').length} cron jobs`,
      details: { results }
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${CRON_JOBS.length} cron jobs`,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Cron provisioning error: ${errorMessage}`)

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
