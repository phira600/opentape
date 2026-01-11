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
const STALE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

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
    // Check current job status with stale recovery
    const { data: cronConfig, error: configError } = await supabase
      .from('cron_job_configurations')
      .select('is_enabled, last_status, last_run_at')
      .eq('id', JOB_ID)
      .single()

    if (configError) {
      console.error(`Failed to fetch job config: ${configError.message}`)
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
    const lastRunAt = cronConfig?.last_run_at ? new Date(cronConfig.last_run_at).getTime() : 0

    // Check if already running - with stale recovery
    if (currentStatus === 'running') {
      const elapsed = Date.now() - lastRunAt
      
      if (elapsed < STALE_THRESHOLD_MS) {
        console.log('Recreate candles job already running')
        return new Response(
          JSON.stringify({ success: false, error: 'Job already running. Please wait for completion.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // Stale running job - recover it
      console.log(`[Recreate Candles] Recovering stale running job (elapsed: ${Math.round(elapsed/1000)}s)`)
      await supabase.from('activity_logs').insert({
        log_type: 'warning',
        message: `Recovered stale recreate-candles job (was running for ${Math.round(elapsed/1000)}s)`,
        details: { elapsed_ms: elapsed }
      })
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

    console.log(`[Recreate Candles] Starting optimized backfill from ${body.from_date} to ${body.to_date}`)

    // Log start
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Starting candle backfill: ${body.from_date} to ${body.to_date}`,
      details: { from_date: body.from_date, to_date: body.to_date }
    })

    // Process trades with optimized O(1) aggregation
    const result = await processTradesOptimized(supabase, fromDate, toDate)

    // Note: daily_stats is updated by tr_update_daily_stats_on_trade trigger when trades are inserted
    // We don't update it here since we're recreating candles, not inserting new trades

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
      log_type: 'success',
      message: `Candle backfill complete: ${result.candleCount} candles from ${result.tradeCount} trades in ${Math.round(duration/1000)}s`,
      details: { 
        from_date: body.from_date, 
        to_date: body.to_date,
        candle_count: result.candleCount,
        trade_count: result.tradeCount,
        duration_ms: duration,
        hours_processed: result.hoursProcessed
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
        hours_processed: result.hoursProcessed,
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

// Optimized O(1) per-trade aggregation - no arrays, no sorting, no Math.max spread
async function processTradesOptimized(supabase: any, fromDate: Date, toDate: Date) {
  let totalTrades = 0
  let totalCandles = 0
  let hoursProcessed = 0

  const hourStart = new Date(fromDate)
  hourStart.setMinutes(0, 0, 0)

  console.log(`[Recreate Candles] Processing trades from ${fromDate.toISOString()} to ${toDate.toISOString()}`)

  while (hourStart < toDate) {
    const hourEnd = new Date(hourStart)
    hourEnd.setHours(hourEnd.getHours() + 1)

    const result = await processHourOptimized(supabase, hourStart, hourEnd > toDate ? toDate : hourEnd)
    
    totalTrades += result.tradeCount
    totalCandles += result.candleCount
    hoursProcessed++

    // Progress logging every 10 hours
    if (hoursProcessed % 10 === 0 || result.tradeCount > 0) {
      const elapsed = Math.round((Date.now() - hourStart.getTime()) / 1000)
      console.log(`[Recreate Candles] Progress: ${hoursProcessed} hours, ${totalCandles} candles, ${totalTrades} trades`)
    }

    hourStart.setHours(hourStart.getHours() + 1)
  }

  console.log(`[Recreate Candles] Total: ${totalCandles} candles from ${totalTrades} trades in ${hoursProcessed} hours`)
  return { candleCount: totalCandles, tradeCount: totalTrades, hoursProcessed }
}

// Optimized hour processing with O(1) aggregation per trade
async function processHourOptimized(supabase: any, hourStart: Date, hourEnd: Date) {
  let offset = 0
  let tradeCount = 0
  let candleCount = 0

  // Candle map with O(1) updates - tracks timestamps for open/close
  const candleMap = new Map<string, {
    symbol: string
    currency: string
    bucket: string
    open: number
    high: number
    low: number
    close: number
    volume: number
    trade_count: number
    first_trade_ts: string  // Track first trade time for open price
    last_trade_ts: string   // Track last trade time for close price
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

    for (const trade of trades) {
      const bucket = new Date(trade.trade_time)
      bucket.setSeconds(0, 0)
      const bucketStr = bucket.toISOString()
      const currency = trade.currency || 'SEK'
      const key = `${trade.symbol}|${currency}|${bucketStr}`
      const price = Number(trade.price)
      const quantity = Number(trade.quantity)

      const existing = candleMap.get(key)
      
      if (!existing) {
        // First trade for this candle - initialize all values
        candleMap.set(key, {
          symbol: trade.symbol,
          currency,
          bucket: bucketStr,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: quantity,
          trade_count: 1,
          first_trade_ts: trade.trade_time,
          last_trade_ts: trade.trade_time
        })
      } else {
        // O(1) update - simple comparisons for open/close based on timestamps
        if (trade.trade_time < existing.first_trade_ts) {
          existing.open = price
          existing.first_trade_ts = trade.trade_time
        }
        if (trade.trade_time > existing.last_trade_ts) {
          existing.close = price
          existing.last_trade_ts = trade.trade_time
        }
        if (price > existing.high) existing.high = price
        if (price < existing.low) existing.low = price
        existing.volume += quantity
        existing.trade_count++
      }
    }

    offset += trades.length
  }

  // Write candles for this hour
  if (candleMap.size > 0) {
    const candles = Array.from(candleMap.values()).map(c => ({
      symbol: c.symbol,
      currency: c.currency,
      bucket: c.bucket,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      trade_count: c.trade_count,
      first_trade_ts: c.first_trade_ts,
      last_trade_ts: c.last_trade_ts
    }))

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

  return { candleCount, tradeCount }
}
