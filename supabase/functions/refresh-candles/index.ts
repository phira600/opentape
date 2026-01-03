import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Status values for queue mechanism
type JobStatus = 'idle' | 'running' | 'queued' | 'success' | 'failed'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const startTime = Date.now()
  const JOB_ID = 'refresh-candles'

  try {
    // Check current job status for concurrency control
    const { data: cronConfig, error: configError } = await supabase
      .from('cron_job_configurations')
      .select('is_enabled, last_status')
      .eq('id', JOB_ID)
      .single()

    if (configError) {
      console.error(`Failed to fetch job config: ${configError.message}`)
      throw new Error(`Failed to fetch job config: ${configError.message}`)
    }

    // Check if job is enabled
    if (cronConfig && !cronConfig.is_enabled) {
      console.log('Refresh candles job is disabled, skipping')
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'job_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const currentStatus = cronConfig?.last_status as JobStatus || 'idle'

    // Concurrency control based on status
    if (currentStatus === 'running') {
      // Already running - set to queued and return
      await supabase
        .from('cron_job_configurations')
        .update({ last_status: 'queued' })
        .eq('id', JOB_ID)
      
      console.log('Job already running, queued for next run')
      return new Response(
        JSON.stringify({ success: true, queued: true, message: 'Job already running, queued for next run' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (currentStatus === 'queued') {
      // Already queued - skip (only one in queue)
      console.log('Job already queued, skipping')
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'already_queued' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Status is idle/success/failed - proceed with processing
    // Set status to running
    await supabase
      .from('cron_job_configurations')
      .update({ 
        last_status: 'running',
        last_run_at: new Date().toISOString()
      })
      .eq('id', JOB_ID)

    console.log('[Refresh Candles] Starting incremental refresh')

    // Process incremental refresh
    const result = await processIncremental(supabase, startTime)
    
    const duration = Date.now() - startTime

    // Log the refresh
    await supabase.from('mv_refresh_log').insert({
      view_name: 'candles_1min_refresh',
      refreshed_at: new Date().toISOString(),
      refresh_duration_ms: duration,
      rows_count: result.candleCount
    })

    // Check if there's a queued run waiting
    const { data: statusCheck } = await supabase
      .from('cron_job_configurations')
      .select('last_status')
      .eq('id', JOB_ID)
      .single()

    if (statusCheck?.last_status === 'queued') {
      // There's a queued run - set back to running and re-process
      console.log('[Refresh Candles] Queued run detected, re-running')
      
      await supabase
        .from('cron_job_configurations')
        .update({ 
          last_status: 'running',
          last_run_at: new Date().toISOString()
        })
        .eq('id', JOB_ID)

      // Re-run the incremental refresh
      const rerunStartTime = Date.now()
      const rerunResult = await processIncremental(supabase, rerunStartTime)
      const rerunDuration = Date.now() - rerunStartTime

      // Log the re-run refresh
      await supabase.from('mv_refresh_log').insert({
        view_name: 'candles_1min_refresh',
        refreshed_at: new Date().toISOString(),
        refresh_duration_ms: rerunDuration,
        rows_count: rerunResult.candleCount
      })

      // Update final status
      await supabase
        .from('cron_job_configurations')
        .update({
          last_status: 'success',
          last_error: null
        })
        .eq('id', JOB_ID)

      console.log(`[Refresh Candles] Re-run complete: ${rerunResult.candleCount} candles in ${rerunDuration}ms`)

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'incremental',
          duration_ms: duration + rerunDuration,
          initial_run: {
            candles: result.candleCount,
            trades: result.tradeCount,
            duration_ms: duration
          },
          rerun: {
            candles: rerunResult.candleCount,
            trades: rerunResult.tradeCount,
            duration_ms: rerunDuration
          },
          message: `Incremental refresh with re-run: ${result.candleCount + rerunResult.candleCount} total candles`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // No queued run - set final status
    await supabase
      .from('cron_job_configurations')
      .update({
        last_status: 'success',
        last_error: null
      })
      .eq('id', JOB_ID)

    console.log(`[Refresh Candles] Complete: ${result.candleCount} candles from ${result.tradeCount} trades in ${duration}ms`)

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'incremental',
        duration_ms: duration,
        rows_count: result.candleCount,
        trade_count: result.tradeCount,
        message: `Incremental refresh: ${result.candleCount} candles from ${result.tradeCount} trades`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Refresh Candles] Error: ${errorMessage}`)

    // Update status to failed
    await supabase
      .from('cron_job_configurations')
      .update({
        last_status: 'failed',
        last_error: errorMessage
      })
      .eq('id', JOB_ID)

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Process incremental refresh for recently inserted trades
// Finds trades by created_at (when inserted) and builds candles for their trade_time
async function processIncremental(supabase: any, startTime: number) {
  // Get last refresh time from mv_refresh_log
  const { data: lastRefresh } = await supabase
    .from('mv_refresh_log')
    .select('refreshed_at')
    .eq('view_name', 'candles_1min_refresh')
    .order('refreshed_at', { ascending: false })
    .limit(1)
    .single()

  // Look for trades CREATED (inserted) since last refresh, with 2-minute lookback
  const lookbackMinutes = 2
  const createdSince = lastRefresh 
    ? new Date(new Date(lastRefresh.refreshed_at).getTime() - lookbackMinutes * 60 * 1000)
    : new Date(Date.now() - 60 * 60 * 1000) // First run: last hour

  console.log(`[Incremental] Finding trades created since ${createdSince.toISOString()}`)

  // Fetch recently created trades (paged to avoid 1000 row limit)
  const pageSize = 5000
  const trades: any[] = []
  let page = 0

  while (true) {
    const { data: tradesPage, error: tradesError } = await supabase
      .from('trades_normalized')
      .select('symbol, currency, trade_time, price, quantity')
      .gte('created_at', createdSince.toISOString())
      .order('trade_time', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (tradesError) {
      throw new Error(`Failed to fetch trades: ${tradesError.message}`)
    }

    if (tradesPage && tradesPage.length > 0) {
      trades.push(...tradesPage)
    }

    if (!tradesPage || tradesPage.length < pageSize) break
    page++
    if (page >= 50) break // hard stop at 250k trades
  }

  console.log(`Found ${trades.length} recently created trades`)

  if (trades.length === 0) {
    return { candleCount: 0, tradeCount: 0 }
  }

  // Find the oldest trade_time from these trades, subtract 2 minutes, round to :00
  const oldestTradeTime = new Date(trades[0].trade_time)
  const candleStartTime = new Date(oldestTradeTime.getTime() - 2 * 60 * 1000)
  candleStartTime.setSeconds(0, 0) // Round to minute boundary

  console.log(`[Incremental] Building candles starting from ${candleStartTime.toISOString()}`)

  // Group trades by symbol + currency + minute bucket
  const candleMap = new Map<string, {
    symbol: string
    currency: string
    bucket: string
    prices: { price: number, time: string }[]
    volume: number
    trade_count: number
  }>()

  for (const trade of trades) {
    const tradeTime = new Date(trade.trade_time)
    
    // Skip trades older than our candle start time (they've already been processed)
    if (tradeTime < candleStartTime) continue

    const bucket = new Date(tradeTime)
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

  // Convert to candles array
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

  console.log(`Generated ${candles.length} candles from ${trades.length} trades`)

  // Upsert candles in batches
  const batchSize = 500
  let upsertedCount = 0

  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize)
    const { error: upsertError } = await supabase
      .from('candles_1min')
      .upsert(batch, { onConflict: 'symbol,currency,bucket' })

    if (upsertError) {
      console.error(`Upsert batch error: ${upsertError.message}`)
      throw new Error(`Failed to upsert candles: ${upsertError.message}`)
    }
    upsertedCount += batch.length
  }

  return { candleCount: upsertedCount, tradeCount: trades.length }
}
