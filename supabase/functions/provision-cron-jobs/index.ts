import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CronJobDefinition {
  name: string
  schedule: string
  function_name: string
  body?: Record<string, string>
  description: string
  config_id?: string  // Maps to cron_job_configurations.id for UI sync
}

// Each data source gets its own cron job for parallel execution
const CRON_JOBS: CronJobDefinition[] = [
  // CBOE Jobs - run every minute on weekdays
  {
    name: 'fetch-cboe-bxe',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'cboe_bxe' },
    description: 'Fetches trade files from CBOE BXE'
  },
  {
    name: 'fetch-cboe-cxe',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'cboe_cxe' },
    description: 'Fetches trade files from CBOE CXE'
  },
  {
    name: 'fetch-cboe-dxe',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'cboe_dxe' },
    description: 'Fetches trade files from CBOE DXE'
  },
  // LSEG Jobs - run every minute on weekdays
  {
    name: 'fetch-lseg-trqx',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'lseg_trqx' },
    description: 'Fetches trade files from LSEG Turquoise UK'
  },
  {
    name: 'fetch-lseg-tqex',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'lseg_tqex' },
    description: 'Fetches trade files from LSEG Turquoise Europe'
  },
  {
    name: 'fetch-lseg-xlon',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'lseg_xlon' },
    description: 'Fetches trade files from LSEG LSE'
  },
  // Nasdaq Job - run every minute on weekdays
  {
    name: 'fetch-nasdaq',
    schedule: '* * * * 1-5',
    function_name: 'fetch-trade-files',
    body: { source_type: 'nasdaq' },
    description: 'Fetches trade files from Nasdaq Nordic'
  },
  // Maintenance jobs - running every 4 hours to clear backlog faster
  {
    name: 'cleanup-old-trades-daily',
    schedule: '0 */4 * * *',
    function_name: 'cleanup-old-trades',
    description: 'Cleans up old trades based on retention settings (every 4 hours)',
    config_id: 'cleanup-old-trades'  // Maps to cron_job_configurations.id
  },
  {
    name: 'cboe-sis-symbology-daily',
    schedule: '0 8 * * 1-5',
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
        const functionUrl = `${supabaseUrl}/functions/v1/${job.function_name}`
        const bodyJson = job.body ? JSON.stringify(job.body) : '{}'
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
          
          // Sync schedule to cron_job_configurations table for UI display
          if (job.config_id) {
            const { error: syncError } = await supabase
              .from('cron_job_configurations')
              .update({ 
                schedule: job.schedule,
                updated_at: new Date().toISOString()
              })
              .eq('id', job.config_id)
            
            if (syncError) {
              console.log(`Note: Could not sync schedule to config table for ${job.config_id}: ${syncError.message}`)
            } else {
              console.log(`Synced schedule to config table for ${job.config_id}`)
            }
          }
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
