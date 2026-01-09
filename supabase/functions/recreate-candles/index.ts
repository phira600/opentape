import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RecreateRequest {
  from_date: string  // Required: YYYY-MM-DD
  to_date: string    // Required: YYYY-MM-DD
}

// Status values for job tracking
type JobStatus = 'idle' | 'running' | 'queued' | 'success' | 'failed'

const JOB_ID = 'recreate-candles'

// Supabase API has a hard limit of 1000 rows per request
const BATCH_SIZE = 1000
const CANDLE_UPSERT_BATCH = 500

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const startTime = Date.now()

  // Parse request body
  let body: RecreateRequest
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON body. Required: from_date, to_date (YYYY-MM-DD)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate required parameters
  if (!body.from_date || !body.to_date) {
    return new Response(
      JSON.stringify({ success: false, error: 'Required parameters: from_date, to_date (YYYY-MM-DD format)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Parse dates
  const fromDate = new Date(body.from_date + 'T00:00:00Z')
  const toDate = new Date(body.to_date + 'T23:59:59.999Z')

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (fromDate > toDate) {
    return new Response(
      JSON.stringify({ success: false, error: 'from_date must be before or equal to to_date' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Check current job status
    const { data: cronConfig, error: configError } = await supabase
      .from('cron_job_configurations')
      .select('is_enabled, last_status')
      .eq('id', JOB_ID)
      .single()

    if (configError) {
      console.error(`Failed to fetch job config: ${configError.message}`)
      // Continue anyway - job config might not exist yet
    }

    // Check if job is enabled
    if (cronConfig && !cronConfig.is_enabled) {
      console.log('Recreate candles job is disabled')
      return new Response(
        JSON.stringify({ success: false, error: 'Recreate candles job is disabled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const currentStatus = cronConfig?.last_status as JobStatus || 'idle'

    // Check if already running
    if (currentStatus === 'running') {
      console.log('Recreate candles job already running')
      return new Response(
        JSON.stringify({ success: false, error: 'Job already running. Please wait for completion.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Set status to running
    await supabase
      .from('cron_job_configurations')
      .update({ 
        last_status: 'running',
        last_run_at: new Date().toISOString(),
        last_error: null
      })
      .eq('id', JOB_ID)

    console.log(`[Recreate Candles] Starting upsert backfill from ${body.from_date} to ${body.to_date}`)

    // Log start
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Starting candle upsert backfill: ${body.from_date} to ${body.to_date}`,
      details: { from_date: body.from_date, to_date: body.to_date }
    })

    // Process trades with dynamic batching
    const result = await processTradesWithDynamicBatching(supabase, fromDate, toDate)

    // Update daily_stats for affected dates
    await updateDailyStats(supabase, fromDate, toDate)

    const duration = Date.now() - startTime

    // Log the refresh
    await supabase.from('mv_refresh_log').insert({
      view_name: 'candles_1min',
      refreshed_at: new Date().toISOString(),
      refresh_duration_ms: duration,
      rows_count: result.candleCount
    })

    // Update status to success
    await supabase
      .from('cron_job_configurations')
      .update({
        last_status: 'success',
        last_error: null
      })
      .eq('id', JOB_ID)

    // Log completion
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Candle backfill complete: ${result.candleCount} candles from ${result.tradeCount} trades in ${Math.round(duration/1000)}s`,
      details: { 
        from_date: body.from_date, 
        to_date: body.to_date,
        candle_count: result.candleCount,
        trade_count: result.tradeCount,
        duration_ms: duration,
        batches_processed: result.batchesProcessed
      }
    })

    console.log(`[Recreate Candles] Complete: ${result.candleCount} candles from ${result.tradeCount} trades in ${duration}ms`)

    return new Response(
      JSON.stringify({
        success: true,
        from_date: body.from_date,
        to_date: body.to_date,
        duration_ms: duration,
        rows_count: result.candleCount,
        trade_count: result.tradeCount,
        batches_processed: result.batchesProcessed,
        message: `Backfill complete: ${result.candleCount} candles from ${result.tradeCount} trades`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Recreate Candles] Error: ${errorMessage}`)

    // Update status to failed
    await supabase
      .from('cron_job_configurations')
      .update({
        last_status: 'failed',
        last_error: errorMessage
      })
      .eq('id', JOB_ID)

    // Log error
    await supabase.from('activity_logs').insert({
      log_type: 'error',
      message: `Candle backfill failed: ${errorMessage}`,
      details: { from_date: body.from_date, to_date: body.to_date, error: errorMessage }
    })

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Process trades hour-by-hour to avoid memory exhaustion
async function processTradesWithDynamicBatching(supabase: any, fromDate: Date, toDate: Date) {
  let totalTrades = 0
  let totalCandles = 0
  let batchesProcessed = 0

  // Process one hour at a time to limit memory usage
  const hourStart = new Date(fromDate)
  hourStart.setMinutes(0, 0, 0)

  console.log(`[Recreate Candles] Processing trades from ${fromDate.toISOString()} to ${toDate.toISOString()}`)

  while (hourStart < toDate) {
    const hourEnd = new Date(hourStart)
    hourEnd.setHours(hourEnd.getHours() + 1)

    // Process this hour
    const result = await processHour(supabase, hourStart, hourEnd > toDate ? toDate : hourEnd)
    
    totalTrades += result.tradeCount
    totalCandles += result.candleCount
    batchesProcessed += result.batchesProcessed

    if (result.tradeCount > 0) {
      console.log(`[Recreate Candles] Hour ${hourStart.toISOString()}: ${result.candleCount} candles from ${result.tradeCount} trades`)
    }

    hourStart.setHours(hourStart.getHours() + 1)
  }

  console.log(`[Recreate Candles] Total: ${totalCandles} candles from ${totalTrades} trades`)
  return { candleCount: totalCandles, tradeCount: totalTrades, batchesProcessed }
}

// Process a single hour of trades
async function processHour(supabase: any, hourStart: Date, hourEnd: Date) {
  let offset = 0
  let tradeCount = 0
  let candleCount = 0
  let batchesProcessed = 0

  // Candles for this hour only
  const candleMap = new Map<string, {
    symbol: string
    currency: string
    bucket: string
    prices: { price: number, time: string }[]
    volume: number
    trade_count: number
  }>()

  while (true) {
    const { data: trades, error: tradesError } = await supabase
      .from('trades_normalized')
      .select('symbol, currency, trade_time, price, quantity')
      .gte('trade_time', hourStart.toISOString())
      .lt('trade_time', hourEnd.toISOString())
      .order('trade_time', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (tradesError) {
      throw new Error(`Failed to fetch trades: ${tradesError.message}`)
    }

    if (!trades || trades.length === 0) {
      break
    }

    tradeCount += trades.length
    batchesProcessed++

    for (const trade of trades) {
      const bucket = new Date(trade.trade_time)
      bucket.setSeconds(0, 0)
      const bucketStr = bucket.toISOString()
      const currency = trade.currency || 'SEK'
      const key = `${trade.symbol}|${currency}|${bucketStr}`

      if (!candleMap.has(key)) {
        candleMap.set(key, {
          symbol: trade.symbol,
          currency,
          bucket: bucketStr,
          prices: [],
          volume: 0,
          trade_count: 0
        })
      }

      const candle = candleMap.get(key)!
      candle.prices.push({ price: Number(trade.price), time: trade.trade_time })
      candle.volume += Number(trade.quantity)
      candle.trade_count++
    }

    offset += trades.length
  }

  // Write candles for this hour immediately (frees memory)
  if (candleMap.size > 0) {
    const candles = Array.from(candleMap.values()).map(c => {
      const sortedPrices = c.prices.sort((a, b) => a.time.localeCompare(b.time))
      const prices = sortedPrices.map(p => p.price)
      return {
        symbol: c.symbol,
        currency: c.currency,
        bucket: c.bucket,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume: c.volume,
        trade_count: c.trade_count
      }
    })

    for (let i = 0; i < candles.length; i += CANDLE_UPSERT_BATCH) {
      const batch = candles.slice(i, i + CANDLE_UPSERT_BATCH)
      const { error: upsertError } = await supabase
        .from('candles_1min')
        .upsert(batch, { onConflict: 'symbol,currency,bucket' })

      if (upsertError) {
        throw new Error(`Failed to upsert candles: ${upsertError.message}`)
      }
      candleCount += batch.length
    }
  }

  return { candleCount, tradeCount, batchesProcessed }
}

// Update daily_stats for affected dates
async function updateDailyStats(supabase: any, startDate: Date, endDate: Date) {
  const dates: string[] = []
  const current = new Date(startDate)
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0])
    current.setUTCDate(current.getUTCDate() + 1)
  }

  console.log(`[Recreate Candles] Updating daily_stats for ${dates.length} days`)

  for (const date of dates) {
    const dayStart = new Date(date + 'T00:00:00Z')
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

    // Count trades for this day
    const { count: tradeCount } = await supabase
      .from('trades_normalized')
      .select('*', { count: 'exact', head: true })
      .gte('trade_time', dayStart.toISOString())
      .lt('trade_time', dayEnd.toISOString())

    // Get unique symbols and venues (limited sample)
    const { data: sampleData } = await supabase
      .from('trades_normalized')
      .select('symbol, venue')
      .gte('trade_time', dayStart.toISOString())
      .lt('trade_time', dayEnd.toISOString())
      .limit(10000)

    const uniqueSymbols = new Set(sampleData?.map((t: any) => t.symbol) || [])
    const uniqueVenues = new Set(sampleData?.map((t: any) => t.venue) || [])

    // Upsert daily stats
    await supabase
      .from('daily_stats')
      .upsert({
        date,
        total_trades: tradeCount || 0,
        unique_symbols: uniqueSymbols.size,
        unique_venues: uniqueVenues.size,
        last_updated: new Date().toISOString()
      }, { onConflict: 'date' })
  }

  console.log(`[Recreate Candles] Updated daily_stats for ${dates.length} days`)
}
