import { createClient } from 'npm:@supabase/supabase-js@2'

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
  config_id?: string
}

interface JobConfiguration {
  id: string
  name: string
  source_type: string
  is_enabled: boolean
  run_days?: string[]
  run_start_hour?: number
  run_end_hour?: number
  fetch_interval_seconds?: number
}

// Static maintenance jobs - these use cron_job_configurations for schedules
const STATIC_CRON_JOBS: CronJobDefinition[] = [
  {
    name: 'cleanup-old-trades-daily',
    schedule: '0 */2 * * *',
    function_name: 'cleanup-old-trades',
    description: 'Trades cleanup based on retention settings (every 2 hours)',
    config_id: 'cleanup-old-trades'
  },
  {
    name: 'cleanup-old-candles-daily',
    schedule: '0 */2 * * *',
    function_name: 'cleanup-old-candles',
    description: 'Candles cleanup based on retention settings (every 2 hours)',
    config_id: 'cleanup-old-candles'
  },
  {
    name: 'cleanup-old-activity-logs-job',
    schedule: '0 */2 * * *',
    function_name: 'cleanup-old-activity-logs',
    description: 'Activity Logs cleanup based on retention settings (every 2 hours)',
    config_id: 'cleanup-old-activity-logs'
  },
  {
    name: 'cleanup-old-processed-files-job',
    schedule: '0 */2 * * *',
    function_name: 'cleanup-old-processed-files',
    description: 'Processed Files cleanup based on retention settings (every 2 hours)',
    config_id: 'cleanup-old-processed-files'
  },
  {
    name: 'cboe-sis-symbology-daily',
    schedule: '0 8 * * 1-5',
    function_name: 'fetch-symbology',
    description: 'Fetches symbol listings from CBOE SIS'
  }
]

/**
 * Convert day numbers to compact cron format
 * e.g., [1,2,3,4,5] → "1-5", [1,3,5] → "1,3,5"
 */
function compactDayRange(days: number[]): string {
  if (days.length === 0) return '1-5' // Default Mon-Fri
  if (days.length === 1) return days[0].toString()
  
  // Check if consecutive
  const sorted = [...days].sort((a, b) => a - b)
  const isConsecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  
  if (isConsecutive) {
    return `${sorted[0]}-${sorted[sorted.length - 1]}`
  }
  
  return sorted.join(',')
}

/**
 * Build minute field for cron based on interval
 * Examples:
 * - 1 minute: "*" (every minute)
 * - 5 minutes: "* /5" (every 5 min)
 * - 30 minutes: "0,30" (explicit minutes)
 * - 60 minutes: "0" (on the hour)
 */
function buildMinuteField(intervalMinutes: number): string {
  if (intervalMinutes <= 1) {
    return '*'
  } else if (intervalMinutes === 60) {
    return '0'
  } else if (intervalMinutes === 30) {
    return '0,30'
  } else if (intervalMinutes === 20) {
    return '0,20,40'
  } else if (intervalMinutes === 15) {
    return '0,15,30,45'
  } else if (60 % intervalMinutes === 0) {
    // Clean divisor of 60 - use */N syntax
    return `*/${intervalMinutes}`
  } else {
    // Non-standard interval - use */N which will run approximately
    return `*/${intervalMinutes}`
  }
}

/**
 * Build cron schedule from job configuration with DST buffer.
 * Adds 1-hour buffer on each side to account for timezone DST shifts.
 * The actual schedule enforcement happens via guard clause in fetch-trade-files.
 */
function buildCronScheduleWithBuffer(job: {
  run_days?: string[]
  run_start_hour?: number
  run_end_hour?: number
  timezone?: string
  fetch_interval_seconds?: number
}): string {
  const runDays = job.run_days || ['mon', 'tue', 'wed', 'thu', 'fri']
  const startHour = job.run_start_hour ?? 8
  const endHour = job.run_end_hour ?? 17
  const intervalSeconds = job.fetch_interval_seconds ?? 60
  const intervalMinutes = Math.max(1, Math.min(60, Math.round(intervalSeconds / 60)))
  
  // Map day names to cron day numbers (0=Sun, 1=Mon, ..., 6=Sat)
  const dayMap: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
  }
  
  // Convert day names to numbers and sort
  const dayNumbers = runDays
    .map(d => dayMap[d.toLowerCase()])
    .filter(n => n !== undefined)
    .sort((a, b) => a - b)
  
  // Build day-of-week field
  const daysField = compactDayRange(dayNumbers)
  
  // Add 1-hour buffer on each side for DST transitions
  // This ensures the cron fires even during clock change days
  // The guard clause in fetch-trade-files will enforce the actual local schedule
  const bufferStart = Math.max(0, startHour - 1)
  const bufferEnd = Math.min(23, endHour) // endHour is exclusive, so no +1 needed
  
  // Build hour range with buffer
  const hourRange = bufferStart === bufferEnd 
    ? bufferStart.toString() 
    : `${bufferStart}-${bufferEnd}`
  
  // Build minute field based on configured interval
  const minuteField = buildMinuteField(intervalMinutes)
  
  // Cron format: minute hour day-of-month month day-of-week
  return `${minuteField} ${hourRange} * * ${daysField}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  try {
    // Check authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Verify the user's JWT
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: claims, error: claimsError } = await userClient.auth.getClaims(token)

    if (claimsError || !claims?.claims?.sub) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const userId = claims.claims.sub

    // Create service client for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check if user has admin role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .single()

    if (!roleData) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    console.log('Provisioning cron jobs...')
    console.log(`Supabase URL: ${supabaseUrl}`)

    const results: { name: string; status: string; schedule?: string; error?: string }[] = []

    // === PART 1: Dynamic fetch jobs from job_configurations ===
    const { data: fetchJobs, error: fetchJobsError } = await supabase
      .from('job_configurations')
      .select('id, name, source_type, is_enabled, run_days, run_start_hour, run_end_hour, fetch_interval_seconds')
      .eq('is_enabled', true)

    if (fetchJobsError) {
      console.error(`Failed to fetch job configurations: ${fetchJobsError.message}`)
    } else if (fetchJobs && fetchJobs.length > 0) {
      console.log(`Found ${fetchJobs.length} enabled fetch jobs`)

      for (const fetchJob of fetchJobs as JobConfiguration[]) {
        try {
          const cronName = `fetch-${fetchJob.source_type.replace(/_/g, '-')}`
          const schedule = buildCronScheduleWithBuffer(fetchJob)

          console.log(`Building cron for ${fetchJob.name}: ${schedule}`)

          // Unschedule existing job
          const { error: unscheduleError } = await supabase.rpc('unschedule_cron_job', {
            job_name: cronName
          }).maybeSingle()

          if (unscheduleError) {
            console.log(`Note: Could not unschedule ${cronName} (may not exist): ${unscheduleError.message}`)
          }

          // Build HTTP POST command
          const functionUrl = `${supabaseUrl}/functions/v1/fetch-trade-files`
          const bodyJson = JSON.stringify({ source_type: fetchJob.source_type })
          const cronCommand = `
            SELECT net.http_post(
              url := '${functionUrl}',
              headers := '{"Content-Type": "application/json", "Authorization": "Bearer ${supabaseAnonKey}"}'::jsonb,
              body := '${bodyJson}'::jsonb
            ) AS request_id;
          `

          // Schedule with dynamic schedule
          const { error: scheduleError } = await supabase.rpc('schedule_cron_job', {
            job_name: cronName,
            job_schedule: schedule,
            job_command: cronCommand
          })

          if (scheduleError) {
            console.error(`Failed to schedule ${cronName}: ${scheduleError.message}`)
            results.push({ name: cronName, status: 'error', schedule, error: scheduleError.message })
          } else {
            console.log(`Successfully scheduled ${cronName} with schedule: ${schedule}`)
            results.push({ name: cronName, status: 'created', schedule })
          }
        } catch (jobError) {
          const errorMsg = jobError instanceof Error ? jobError.message : 'Unknown error'
          const cronName = `fetch-${fetchJob.source_type.replace(/_/g, '-')}`
          console.error(`Error processing ${cronName}: ${errorMsg}`)
          results.push({ name: cronName, status: 'error', error: errorMsg })
        }
      }
    } else {
      console.log('No enabled fetch jobs found in job_configurations')
    }

    // === PART 2: Static maintenance jobs ===
    for (const job of STATIC_CRON_JOBS) {
      try {
        // Unschedule existing job
        const { error: unscheduleError } = await supabase.rpc('unschedule_cron_job', {
          job_name: job.name
        }).maybeSingle()

        if (unscheduleError) {
          console.log(`Note: Could not unschedule ${job.name} (may not exist): ${unscheduleError.message}`)
        }

        // Build HTTP POST command
        const functionUrl = `${supabaseUrl}/functions/v1/${job.function_name}`
        const bodyJson = job.body ? JSON.stringify(job.body) : '{}'
        const cronCommand = `
          SELECT net.http_post(
            url := '${functionUrl}',
            headers := '{"Content-Type": "application/json", "Authorization": "Bearer ${supabaseAnonKey}"}'::jsonb,
            body := '${bodyJson}'::jsonb
          ) AS request_id;
        `

        // Schedule the cron job
        const { error: scheduleError } = await supabase.rpc('schedule_cron_job', {
          job_name: job.name,
          job_schedule: job.schedule,
          job_command: cronCommand
        })

        if (scheduleError) {
          console.error(`Failed to schedule ${job.name}: ${scheduleError.message}`)
          results.push({ name: job.name, status: 'error', schedule: job.schedule, error: scheduleError.message })
        } else {
          console.log(`Successfully scheduled ${job.name} with schedule: ${job.schedule}`)
          results.push({ name: job.name, status: 'created', schedule: job.schedule })

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
    const createdCount = results.filter(r => r.status === 'created').length
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Provisioned ${createdCount} cron jobs (dynamic schedules enabled)`,
      details: { results }
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} cron jobs (${createdCount} created)`,
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
