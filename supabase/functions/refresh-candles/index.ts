import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RefreshRequest {
  update_status?: boolean
  days_back?: number  // Number of days back from yesterday to refresh (default: 7)
  from_date?: string  // ISO date string for start of range
  to_date?: string    // ISO date string for end of range
  incremental?: boolean  // If true, do incremental refresh for recent trades only
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const startTime = Date.now()

  // Parse request body
  let body: RefreshRequest = {}
  try {
    body = await req.json()
  } catch {
    // No body or invalid JSON - default behavior
  }
  
  // Only update cron status if explicitly requested
  const updateCronStatus = body.update_status === true
  
  // If this is a cron-triggered run, check if job is enabled
  if (updateCronStatus) {
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

  // Determine mode: incremental (for background calls) or historical (for cron/manual)
  const isIncremental = body.incremental === true
  
  try {
    if (isIncremental) {
      // INCREMENTAL MODE: Process recent trades (used after file downloads)
      return await processIncremental(supabase, startTime)
    } else {
      // HISTORICAL MODE: Recreate candles for date range (used by cron job or manual)
      // If from_date/to_date provided, use them; otherwise calculate from days_back
      const daysBack = body.days_back ?? 7  // Default: 7 days
      return await processHistorical(supabase, startTime, daysBack, updateCronStatus, body.from_date, body.to_date)
    }
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

// Process incremental refresh for recently inserted trades (after file downloads)
// This finds trades by created_at (when inserted) and builds candles for their trade_time
async function processIncremental(supabase: any, startTime: number) {
  // Get last refresh time from mv_refresh_log
  const { data: lastRefresh } = await supabase
    .from('mv_refresh_log')
    .select('refreshed_at')
    .eq('view_name', 'candles_1min')
    .order('refreshed_at', { ascending: false })
    .limit(1)
    .single()

  // Look for trades CREATED (inserted) since last refresh, with 2-minute overlap for safety
  const lookbackMinutes = 2
  const createdSince = lastRefresh 
    ? new Date(new Date(lastRefresh.refreshed_at).getTime() - lookbackMinutes * 60 * 1000)
    : new Date(Date.now() - 60 * 60 * 1000) // First run: last hour

  console.log(`[Incremental] Finding trades created since ${createdSince.toISOString()}`)

  const result = await processRecentlyCreatedTrades(supabase, createdSince, startTime)
  
  // Log the refresh
  await supabase.from('mv_refresh_log').insert({
    view_name: 'candles_1min',
    refreshed_at: new Date().toISOString(),
    refresh_duration_ms: Date.now() - startTime,
    rows_count: result.candleCount
  })

  return new Response(
    JSON.stringify({
      success: true,
      mode: 'incremental',
      duration_ms: Date.now() - startTime,
      rows_count: result.candleCount,
      trade_count: result.tradeCount,
      message: `Incremental refresh: ${result.candleCount} candles from ${result.tradeCount} trades`
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Process historical refresh for a date range
async function processHistorical(
  supabase: any, 
  startTime: number, 
  daysBack: number, 
  updateCronStatus: boolean,
  fromDateStr?: string,
  toDateStr?: string
) {
  let startDate: Date
  let endDate: Date

  if (fromDateStr && toDateStr) {
    // Use provided date range
    startDate = new Date(fromDateStr)
    startDate.setUTCHours(0, 0, 0, 0)
    endDate = new Date(toDateStr)
    endDate.setUTCHours(23, 59, 59, 999)  // End of the to_date day
    console.log(`[Historical] Using provided date range: ${startDate.toISOString()} to ${endDate.toISOString()}`)
  } else {
    // Calculate date range: T-daysBack to T-1 (yesterday end of day)
    const now = new Date()
    endDate = new Date(now)
    endDate.setUTCHours(0, 0, 0, 0)  // Start of today = end of yesterday
    
    startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - daysBack)  // Go back daysBack days
    console.log(`[Historical] Refreshing candles from ${startDate.toISOString()} to ${endDate.toISOString()} (${daysBack} days)`)
  }

  // Delete existing candles in this range first
  const { error: deleteError } = await supabase
    .from('candles_1min')
    .delete()
    .gte('bucket', startDate.toISOString())
    .lt('bucket', endDate.toISOString())

  if (deleteError) {
    console.error(`Failed to delete existing candles: ${deleteError.message}`)
    throw new Error(`Failed to delete existing candles: ${deleteError.message}`)
  }

  console.log(`Deleted existing candles in range`)

  // Process the range
  const result = await processTradesInRange(supabase, startDate, endDate, startTime)

  // Update daily_stats for affected dates
  await updateDailyStats(supabase, startDate, endDate)

  const duration = Date.now() - startTime

  // Log the refresh
  await supabase.from('mv_refresh_log').insert({
    view_name: 'candles_1min',
    refreshed_at: new Date().toISOString(),
    refresh_duration_ms: duration,
    rows_count: result.candleCount
  })

  // Update cron job status if requested
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

  console.log(`[Historical] Complete in ${duration}ms - ${result.candleCount} candles from ${result.tradeCount} trades`)

  return new Response(
    JSON.stringify({
      success: true,
      mode: 'historical',
      days_back: daysBack,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      duration_ms: duration,
      rows_count: result.candleCount,
      trade_count: result.tradeCount,
      message: `Historical refresh (${daysBack} days): ${result.candleCount} candles from ${result.tradeCount} trades`
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Process recently CREATED trades (by created_at) and build candles for their trade_time
// This is the key difference from processTradesInRange - we find trades by insertion time
// but build candles based on when the trade actually occurred
async function processRecentlyCreatedTrades(supabase: any, createdSince: Date, startTime: number) {
  // Fetch trades that were INSERTED recently (regardless of their trade_time) (paged to avoid default 1000 row limit)
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
    if (page >= 50) break // hard stop
  }


  console.log(`Found ${trades?.length || 0} recently created trades`)

  if (!trades || trades.length === 0) {
    return { candleCount: 0, tradeCount: 0 }
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

  console.log(`Generated ${candles.length} candles from recently created trades`)

  // Upsert candles in batches (these will merge with existing candles if any)
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

// Process trades in a given time range and create candles
async function processTradesInRange(supabase: any, fromDate: Date, toDate: Date, startTime: number) {
  // Fetch trades in the time window (paged to avoid default 1000 row limit)
  const pageSize = 5000
  const trades: any[] = []
  let page = 0

  while (true) {
    const { data: tradesPage, error: tradesError } = await supabase
      .from('trades_normalized')
      .select('symbol, currency, trade_time, price, quantity')
      .gte('trade_time', fromDate.toISOString())
      .lt('trade_time', toDate.toISOString())
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
    if (page >= 50) break // hard stop
  }


  console.log(`Fetched ${trades?.length || 0} trades to process`)

  if (!trades || trades.length === 0) {
    return { candleCount: 0, tradeCount: 0 }
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

  return { candleCount: upsertedCount, tradeCount: trades.length }
}

// Update daily_stats for affected dates
async function updateDailyStats(supabase: any, startDate: Date, endDate: Date) {
  // Get unique dates in the range
  const dates: string[] = []
  const current = new Date(startDate)
  while (current < endDate) {
    dates.push(current.toISOString().split('T')[0])
    current.setUTCDate(current.getUTCDate() + 1)
  }

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

  console.log(`Updated daily_stats for ${dates.length} days`)
}
