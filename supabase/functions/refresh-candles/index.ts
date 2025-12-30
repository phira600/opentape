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

  const startTime = Date.now()

  // Check if this is a cron-triggered run (update status) or background call (skip status update)
  let body: { update_status?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // No body or invalid JSON - default behavior
  }
  
  // Only update cron status if explicitly requested (update_status: true)
  // Background calls from fetch-trade-files pass update_status: false
  // pg_cron calls pass empty body {}, which should also NOT update status
  // Status should only be updated when manually triggered or when update_status is explicitly true
  const updateCronStatus = body.update_status === true
  
  // If this is a cron-triggered run (empty body from pg_cron), check if job is enabled
  if (Object.keys(body).length === 0) {
    const { data: cronConfig } = await supabase
      .from('cron_job_configurations')
      .select('is_enabled')
      .eq('id', 'refresh-candles')
      .single()
    
    if (cronConfig && !cronConfig.is_enabled) {
      console.log('Refresh candles cron job is disabled, skipping')
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'cron_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  try {
    // Get last refresh time from mv_refresh_log
    const { data: lastRefresh } = await supabase
      .from('mv_refresh_log')
      .select('refreshed_at')
      .eq('view_name', 'candles_1min')
      .order('refreshed_at', { ascending: false })
      .limit(1)
      .single()

    // Determine the time range to process
    // Use 5-minute lookback for backdated trades, or last 30 minutes for first run
    const lookbackMinutes = lastRefresh ? 5 : 30
    const processFrom = lastRefresh 
      ? new Date(new Date(lastRefresh.refreshed_at).getTime() - lookbackMinutes * 60 * 1000)
      : new Date(Date.now() - 30 * 60 * 1000)

    console.log(`Processing trades from ${processFrom.toISOString()} (lookback: ${lookbackMinutes} min)`)

    // Get max trade time to know our processing window
    const { data: maxTradeData } = await supabase
      .from('trades_normalized')
      .select('trade_time')
      .gte('trade_time', processFrom.toISOString())
      .order('trade_time', { ascending: false })
      .limit(1)
      .single()

    if (!maxTradeData) {
      console.log('No new trades to process')
      
      if (updateCronStatus) {
        await supabase
          .from('cron_job_configurations')
          .update({
            last_run_at: new Date().toISOString(),
            last_status: 'success',
            last_error: null
          })
          .eq('id', 'refresh-candles')
      }

      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'no_new_trades',
          message: 'No new trades to process'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch trades in the time window
    const { data: trades, error: tradesError } = await supabase
      .from('trades_normalized')
      .select('symbol, currency, trade_time, price, quantity')
      .gte('trade_time', processFrom.toISOString())
      .order('trade_time', { ascending: true })

    if (tradesError) {
      throw new Error(`Failed to fetch trades: ${tradesError.message}`)
    }

    console.log(`Fetched ${trades?.length || 0} trades to process`)

    if (!trades || trades.length === 0) {
      if (updateCronStatus) {
        await supabase
          .from('cron_job_configurations')
          .update({
            last_run_at: new Date().toISOString(),
            last_status: 'success',
            last_error: null
          })
          .eq('id', 'refresh-candles')
      }

      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'no_trades_in_window',
          message: 'No trades found in processing window'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    console.log(`Generated ${candles.length} candles`)

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

    // Log the refresh
    await supabase.from('mv_refresh_log').insert({
      view_name: 'candles_1min',
      refreshed_at: new Date().toISOString(),
      refresh_duration_ms: Date.now() - startTime,
      rows_count: upsertedCount
    })

    // Update cron job configuration only if triggered as cron job
    if (updateCronStatus) {
      await supabase
        .from('cron_job_configurations')
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'success',
          last_error: null
        })
        .eq('id', 'refresh-candles')
    }

    const duration = Date.now() - startTime
    console.log(`Candles refresh complete in ${duration}ms - ${upsertedCount} candles from ${trades.length} trades`)

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        rows_count: upsertedCount,
        trade_count: trades.length,
        message: `Candles refreshed successfully (${upsertedCount} candles from ${trades.length} trades)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Candles refresh error: ${errorMessage}`)

    if (updateCronStatus) {
      await supabase
        .from('cron_job_configurations')
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'error',
          last_error: errorMessage
        })
        .eq('id', 'refresh-candles')
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
