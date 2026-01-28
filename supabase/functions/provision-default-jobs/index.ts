import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DefaultJob {
  name: string
  source_url: string
  source_type: string
  is_enabled: boolean
  fetch_interval_seconds: number
  run_days: string[]
  run_start_hour: number
  run_end_hour: number
  timezone: string
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri']

const DEFAULT_JOBS: DefaultJob[] = [
  {
    name: 'CBOE BXE',
    source_url: 'https://www.cboe.com/europe/equities/trade_data/',
    source_type: 'cboe_bxe',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: 'Europe/London',
  },
  {
    name: 'CBOE CXE',
    source_url: 'https://www.cboe.com/europe/equities/trade_data/',
    source_type: 'cboe_cxe',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: 'Europe/London',
  },
  {
    name: 'CBOE DXE',
    source_url: 'https://www.cboe.com/europe/equities/trade_data/',
    source_type: 'cboe_dxe',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: 'Europe/London',
  },
  {
    name: 'Nasdaq Nordic',
    source_url: 'https://tradereports.nasdaq.com/shares/trade-reports/post-trade',
    source_type: 'nasdaq',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 9,
    run_end_hour: 18,
    timezone: 'Europe/Stockholm',
  },
  {
    name: 'LSEG Turquoise UK',
    source_url: 'https://dmd.lseg.com/dmd/TurquoiseUKPost-TradeDocuments',
    source_type: 'lseg_trqx',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: 'Europe/London',
  },
  {
    name: 'LSEG Turquoise Europe',
    source_url: 'https://dmd.lseg.com/dmd/TurquoiseEuropePost-TradeDocuments',
    source_type: 'lseg_tqex',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: 'Europe/London',
  },
  {
    name: 'LSEG LSE',
    source_url: 'https://dmd.lseg.com/dmd/LSEPost-TradeDocuments',
    source_type: 'lseg_xlon',
    is_enabled: true,
    fetch_interval_seconds: 300,
    run_days: WEEKDAYS,
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: 'Europe/London',
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

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
    const userClient = createClient(supabaseUrl, anonKey, {
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

    console.log('Provisioning default jobs...')

    // Check if any jobs already exist
    const { data: existingJobs, error: fetchError } = await supabase
      .from('job_configurations')
      .select('source_type')

    if (fetchError) {
      throw new Error(`Failed to check existing jobs: ${fetchError.message}`)
    }

    const existingTypes = new Set((existingJobs || []).map(j => j.source_type))
    const jobsToCreate = DEFAULT_JOBS.filter(job => !existingTypes.has(job.source_type))

    if (jobsToCreate.length === 0) {
      console.log('All default jobs already exist')
      return new Response(
        JSON.stringify({ success: true, message: 'All default jobs already exist', created: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Insert new jobs
    const { data: createdJobs, error: insertError } = await supabase
      .from('job_configurations')
      .insert(jobsToCreate)
      .select()

    if (insertError) {
      throw new Error(`Failed to create jobs: ${insertError.message}`)
    }

    console.log(`Created ${createdJobs?.length || 0} default jobs`)

    // Log the provisioning
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Provisioned ${createdJobs?.length || 0} default data sources`,
      details: { jobs: jobsToCreate.map(j => j.name) }
    })

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Created ${createdJobs?.length || 0} default jobs`,
        created: createdJobs?.length || 0,
        jobs: createdJobs
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Provisioning error: ${errorMessage}`)

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
