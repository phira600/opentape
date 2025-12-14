import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JobConfiguration {
  id: string
  name: string
  source_url: string
  source_type: 'cboe' | 'lseg' | 'custom'
  is_enabled: boolean
}

interface TradeRecord {
  symbol: string
  price: number
  quantity: number
  trade_time: string
  venue: string
  market_mechanism?: string
  trading_mode?: string
  transaction_id?: string
  raw_data?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { job_id } = await req.json().catch(() => ({}))

    // Fetch enabled jobs (or specific job if job_id provided)
    let query = supabase
      .from('job_configurations')
      .select('*')
      .eq('is_enabled', true)
    
    if (job_id) {
      query = query.eq('id', job_id)
    }

    const { data: jobs, error: jobsError } = await query

    if (jobsError) {
      throw new Error(`Failed to fetch jobs: ${jobsError.message}`)
    }

    if (!jobs || jobs.length === 0) {
      console.log('No enabled jobs found')
      return new Response(
        JSON.stringify({ success: true, message: 'No enabled jobs found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const results = []

    for (const job of jobs as JobConfiguration[]) {
      console.log(`Processing job: ${job.name} (${job.source_type})`)

      // Update job status to running
      await supabase
        .from('job_configurations')
        .update({ last_status: 'running', last_run_at: new Date().toISOString() })
        .eq('id', job.id)

      try {
        // Log start
        await supabase.from('activity_logs').insert({
          job_id: job.id,
          log_type: 'info',
          message: `Starting fetch for ${job.name}`,
          details: { source_url: job.source_url }
        })

        let rawData: string
        let actualUrl: string
        let fileName: string

        if (job.source_type === 'cboe') {
          // CBOE has dynamic URLs based on venue and time
          const cboeResult = await fetchCboeData(job.source_url)
          rawData = cboeResult.data
          actualUrl = cboeResult.url
          fileName = cboeResult.fileName
          console.log(`Fetched CBOE data from: ${actualUrl}`)
        } else {
          // Standard fetch for other sources
          const response = await fetch(job.source_url, {
            headers: { 'Accept': 'application/json, text/csv, */*' }
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          rawData = await response.text()
          actualUrl = job.source_url
          fileName = `fetch_${new Date().toISOString()}`
        }

        // Create a hash of the content to detect duplicates
        const encoder = new TextEncoder()
        const data = encoder.encode(rawData)
        const hashBuffer = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

        // Check if we've already processed this exact content
        const { data: existingFile } = await supabase
          .from('processed_files')
          .select('id')
          .eq('job_id', job.id)
          .eq('file_hash', fileHash)
          .single()

        if (existingFile) {
          console.log(`Skipping duplicate content for job ${job.name}`)
          await supabase.from('activity_logs').insert({
            job_id: job.id,
            log_type: 'info',
            message: 'No new data (content unchanged)',
          })
          
          await supabase
            .from('job_configurations')
            .update({ last_status: 'success' })
            .eq('id', job.id)

          results.push({ job_id: job.id, status: 'skipped', reason: 'duplicate' })
          continue
        }

        // Parse trades based on source type
        const contentType = ''
        let trades: TradeRecord[] = []
        
        if (job.source_type === 'cboe') {
          trades = parseCboeData(rawData, job.name)
        } else if (job.source_type === 'lseg') {
          trades = parseLsegData(rawData, contentType, job.name)
        } else {
          trades = parseGenericData(rawData, contentType, job.name)
        }

        if (trades.length === 0) {
          console.log(`No trades parsed for job ${job.name}`)
          await supabase.from('activity_logs').insert({
            job_id: job.id,
            log_type: 'warning',
            message: 'No trades found in response',
          })
          
          await supabase
            .from('job_configurations')
            .update({ last_status: 'success' })
            .eq('id', job.id)

          results.push({ job_id: job.id, status: 'success', trades_count: 0 })
          continue
        }

        // Insert trades in batches
        const batchSize = 500
        let insertedCount = 0

        for (let i = 0; i < trades.length; i += batchSize) {
          const batch = trades.slice(i, i + batchSize).map(trade => ({
            job_id: job.id,
            ...trade
          }))

          const { error: insertError } = await supabase
            .from('trades_normalized')
            .insert(batch)

          if (insertError) {
            console.error(`Batch insert error: ${insertError.message}`)
          } else {
            insertedCount += batch.length
          }
        }

        // Record processed file
        await supabase.from('processed_files').insert({
          job_id: job.id,
          file_name: fileName,
          file_hash: fileHash,
          records_count: insertedCount
        })

        // Log success
        await supabase.from('activity_logs').insert({
          job_id: job.id,
          log_type: 'success',
          message: `Processed ${insertedCount} trades`,
          details: { trades_count: insertedCount, file: fileName }
        })

        // Update job status
        await supabase
          .from('job_configurations')
          .update({ last_status: 'success', last_error: null })
          .eq('id', job.id)

        results.push({ job_id: job.id, status: 'success', trades_count: insertedCount })

      } catch (jobError) {
        const errorMessage = jobError instanceof Error ? jobError.message : 'Unknown error'
        console.error(`Job ${job.name} failed: ${errorMessage}`)

        await supabase.from('activity_logs').insert({
          job_id: job.id,
          log_type: 'error',
          message: `Fetch failed: ${errorMessage}`,
        })

        await supabase
          .from('job_configurations')
          .update({ last_status: 'error', last_error: errorMessage })
          .eq('id', job.id)

        results.push({ job_id: job.id, status: 'error', error: errorMessage })
      }
    }

    // Refresh materialized view after processing
    await supabase.rpc('refresh_candles')

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Function error: ${errorMessage}`)

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// CBOE URL pattern: https://www.cboe.com/europe/equities/trade_data/
// Actual files are at: https://cdn.cboe.com/data/europe/equities/trade_data/{hash}/minute/rts13_public_trade_data_{venue}_{date}_{HHMM}.csv
// Venues: bxe, cxe, dxe, apa
async function fetchCboeData(sourceUrl: string): Promise<{ data: string; url: string; fileName: string }> {
  // Parse venue from source_url - expect format like "cboe:bxe" or just "bxe"
  // or full URL like https://www.cboe.com/europe/equities/trade_data/
  let venue = 'bxe' // default venue
  
  if (sourceUrl.includes('cboe:')) {
    venue = sourceUrl.split('cboe:')[1].trim().toLowerCase()
  } else if (['bxe', 'cxe', 'dxe', 'apa'].some(v => sourceUrl.toLowerCase().includes(v))) {
    const match = sourceUrl.toLowerCase().match(/(bxe|cxe|dxe|apa)/)
    if (match) venue = match[1]
  }

  // Get current time minus 5 minutes (data is delayed by 15 min, available per minute for last 5 min)
  const now = new Date()
  const fetchTime = new Date(now.getTime() - 5 * 60 * 1000)
  
  const dateStr = fetchTime.toISOString().split('T')[0] // YYYY-MM-DD
  const hour = fetchTime.getUTCHours().toString().padStart(2, '0')
  const minute = fetchTime.getUTCMinutes().toString().padStart(2, '0')
  
  // Try minute file first, then fall back to hourly
  const minuteFileName = `rts13_public_trade_data_${venue}_${dateStr}_${hour}${minute}.csv`
  const hourlyFileName = `rts13_public_trade_data_${venue}_${dateStr}_${hour}.csv`
  
  // The CDN URL pattern - the hash changes daily, so we need to fetch the page to get it
  // For now, try the direct pattern that works
  const baseUrls = [
    `https://www.cboe.com/europe/equities/trade_data/${venue}/minute/${minuteFileName}`,
    `https://www.cboe.com/europe/equities/trade_data/${venue}/hour/${hourlyFileName}`,
  ]

  for (const url of baseUrls) {
    try {
      console.log(`Trying CBOE URL: ${url}`)
      const response = await fetch(url, {
        headers: { 
          'Accept': 'text/csv, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; TradeDataFetcher/1.0)'
        },
        redirect: 'follow'
      })

      if (response.ok) {
        const data = await response.text()
        if (data && data.includes('Timestamp') && data.includes('Symbol')) {
          const fileName = url.includes('minute') ? minuteFileName : hourlyFileName
          return { data, url, fileName }
        }
      }
    } catch (e) {
      console.log(`Failed to fetch ${url}: ${e}`)
    }
  }

  throw new Error(`Failed to fetch CBOE data for venue ${venue}. Tried minute and hourly files.`)
}

// Parse CBOE RTS13 CSV format
// Columns: Timestamp,Trading Date Time,Symbol,Price,Price Notation,Price Currency,
//          Executed Shares,Notional Amount,Notional Currency,Execution Venue,...
function parseCboeData(rawData: string, jobName: string): TradeRecord[] {
  const trades: TradeRecord[] = []
  
  try {
    const lines = rawData.split('\n').filter(line => line.trim())
    
    if (lines.length < 2) {
      console.log('CBOE: No data lines found')
      return trades
    }

    // Parse header to find column indices
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    console.log(`CBOE headers: ${headers.slice(0, 10).join(', ')}...`)
    
    const indices = {
      timestamp: headers.findIndex(h => h === 'timestamp'),
      tradingDateTime: headers.findIndex(h => h === 'trading_date_time'),
      symbol: headers.findIndex(h => h === 'symbol'),
      price: headers.findIndex(h => h === 'price'),
      executedShares: headers.findIndex(h => h === 'executed_shares'),
      executionVenue: headers.findIndex(h => h === 'execution_venue'),
      marketMechanism: headers.findIndex(h => h === 'market_mechanism'),
      tradingMode: headers.findIndex(h => h === 'trading_mode'),
      tradeId: headers.findIndex(h => h === 'trade_id'),
    }

    console.log(`CBOE column indices: symbol=${indices.symbol}, price=${indices.price}, qty=${indices.executedShares}`)

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      
      if (values.length < 7) continue

      const symbol = indices.symbol >= 0 ? values[indices.symbol]?.trim() : ''
      const priceStr = indices.price >= 0 ? values[indices.price]?.trim() : '0'
      const qtyStr = indices.executedShares >= 0 ? values[indices.executedShares]?.trim() : '0'
      const tradeTime = indices.tradingDateTime >= 0 ? values[indices.tradingDateTime]?.trim() : new Date().toISOString()
      const venue = indices.executionVenue >= 0 ? values[indices.executionVenue]?.trim() : 'CBOE'
      
      // Skip if missing required fields
      if (!symbol || symbol === '') continue
      
      const price = parseFloat(priceStr) || 0
      const quantity = parseFloat(qtyStr) || 0
      
      // Skip zero-price or zero-quantity trades
      if (price === 0 || quantity === 0) continue

      trades.push({
        symbol,
        price,
        quantity,
        trade_time: tradeTime,
        venue: venue || 'CBOE',
        market_mechanism: indices.marketMechanism >= 0 ? values[indices.marketMechanism]?.trim() : undefined,
        trading_mode: indices.tradingMode >= 0 ? values[indices.tradingMode]?.trim() : undefined,
        transaction_id: indices.tradeId >= 0 ? values[indices.tradeId]?.trim() : undefined,
      })
    }

    console.log(`CBOE: Parsed ${trades.length} trades from ${lines.length - 1} lines`)
  } catch (e) {
    console.error(`Failed to parse CBOE data for ${jobName}: ${e}`)
  }
  
  return trades
}

// Helper to parse CSV lines properly (handles quoted fields with commas)
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  
  return result
}

function parseLsegData(rawData: string, contentType: string, jobName: string): TradeRecord[] {
  const trades: TradeRecord[] = []
  
  try {
    if (contentType.includes('json') || rawData.trim().startsWith('[') || rawData.trim().startsWith('{')) {
      const jsonData = JSON.parse(rawData)
      const records = Array.isArray(jsonData) ? jsonData : jsonData.data || jsonData.trades || []
      
      for (const record of records) {
        trades.push({
          symbol: record.ric || record.symbol || record.instrumentId || 'UNKNOWN',
          price: parseFloat(record.trdPrc || record.price || 0),
          quantity: parseFloat(record.trdVol || record.volume || record.quantity || 0),
          trade_time: record.trdDtTm || record.timestamp || new Date().toISOString(),
          venue: record.mktMic || 'LSEG',
          market_mechanism: record.mmtMarketMechanism || record.mmt_market_mechanism,
          trading_mode: record.mmtTradingMode || record.mmt_trading_mode,
          transaction_id: record.trdId || record.tradeId,
          raw_data: record
        })
      }
    } else {
      trades.push(...parseCSV(rawData, 'LSEG'))
    }
  } catch (e) {
    console.error(`Failed to parse LSEG data for ${jobName}: ${e}`)
  }
  
  return trades
}

function parseGenericData(rawData: string, contentType: string, jobName: string): TradeRecord[] {
  const trades: TradeRecord[] = []
  
  try {
    if (contentType.includes('json') || rawData.trim().startsWith('[') || rawData.trim().startsWith('{')) {
      const jsonData = JSON.parse(rawData)
      const records = Array.isArray(jsonData) ? jsonData : jsonData.data || jsonData.trades || jsonData.results || []
      
      for (const record of records) {
        const symbolKey = Object.keys(record).find(k => 
          ['symbol', 'ticker', 'instrument', 'ric', 'isin'].includes(k.toLowerCase())
        )
        const priceKey = Object.keys(record).find(k => 
          ['price', 'lastprice', 'trdprc', 'close'].includes(k.toLowerCase())
        )
        const quantityKey = Object.keys(record).find(k => 
          ['quantity', 'volume', 'size', 'trdvol', 'qty'].includes(k.toLowerCase())
        )
        const timeKey = Object.keys(record).find(k => 
          ['timestamp', 'time', 'datetime', 'trddttm', 'tradetime'].includes(k.toLowerCase())
        )
        
        trades.push({
          symbol: symbolKey ? record[symbolKey] : 'UNKNOWN',
          price: parseFloat(priceKey ? record[priceKey] : 0),
          quantity: parseFloat(quantityKey ? record[quantityKey] : 0),
          trade_time: timeKey ? record[timeKey] : new Date().toISOString(),
          venue: record.venue || record.exchange || record.market || 'UNKNOWN',
          market_mechanism: record.marketMechanism || record.mmt_market_mechanism,
          trading_mode: record.tradingMode || record.mmt_trading_mode,
          transaction_id: record.tradeId || record.transactionId || record.id,
          raw_data: record
        })
      }
    } else {
      trades.push(...parseCSV(rawData, 'UNKNOWN'))
    }
  } catch (e) {
    console.error(`Failed to parse generic data for ${jobName}: ${e}`)
  }
  
  return trades
}

function parseCSV(csvData: string, defaultVenue: string): TradeRecord[] {
  const trades: TradeRecord[] = []
  const lines = csvData.split('\n').filter(line => line.trim())
  
  if (lines.length < 2) return trades
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  
  const symbolIdx = headers.findIndex(h => ['symbol', 'ticker', 'instrument'].includes(h))
  const priceIdx = headers.findIndex(h => ['price', 'lastprice', 'trdprc'].includes(h))
  const quantityIdx = headers.findIndex(h => ['quantity', 'volume', 'size', 'qty', 'executed_shares'].includes(h))
  const timeIdx = headers.findIndex(h => ['timestamp', 'time', 'datetime', 'trading_date_time'].includes(h))
  const venueIdx = headers.findIndex(h => ['venue', 'exchange', 'market', 'execution_venue'].includes(h))
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    
    if (values.length < Math.max(symbolIdx, priceIdx, quantityIdx) + 1) continue
    
    trades.push({
      symbol: symbolIdx >= 0 ? values[symbolIdx]?.trim() : 'UNKNOWN',
      price: parseFloat(priceIdx >= 0 ? values[priceIdx]?.trim() : '0'),
      quantity: parseFloat(quantityIdx >= 0 ? values[quantityIdx]?.trim() : '0'),
      trade_time: timeIdx >= 0 ? values[timeIdx]?.trim() : new Date().toISOString(),
      venue: venueIdx >= 0 ? values[venueIdx]?.trim() : defaultVenue,
    })
  }
  
  return trades
}
