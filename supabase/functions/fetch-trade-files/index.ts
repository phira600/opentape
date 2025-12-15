import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JobConfiguration {
  id: string
  name: string
  source_url: string
  source_type: 'cboe' | 'cboe_bxe' | 'cboe_cxe' | 'cboe_dxe' | 'cboe_sis' | 'nasdaq' | 'lseg' | 'custom'
  is_enabled: boolean
  last_run_at: string | null
}

interface FetchedFile {
  data: string
  url: string
  fileName: string
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

        // Fetch all files since last run
        const files: FetchedFile[] = []
        
        if (job.source_type === 'cboe_sis') {
          // Skip SIS jobs - they use fetch-symbology function instead
          console.log(`Skipping SIS job ${job.name} - handled by fetch-symbology`)
          await supabase.from('activity_logs').insert({
            job_id: job.id,
            log_type: 'info',
            message: 'SIS symbology handled by dedicated function',
          })
          
          await supabase
            .from('job_configurations')
            .update({ last_status: 'success' })
            .eq('id', job.id)

          results.push({ job_id: job.id, status: 'skipped', reason: 'handled by fetch-symbology' })
          continue
        } else if (job.source_type === 'cboe' || job.source_type === 'cboe_bxe' || job.source_type === 'cboe_cxe' || job.source_type === 'cboe_dxe') {
          // CBOE has dynamic URLs based on venue and time - fetch all since last run
          const venue = job.source_type.replace('cboe_', '') === 'cboe' ? 'bxe' : job.source_type.replace('cboe_', '')
          const cboeFiles = await fetchCboeDataSinceLastRun(venue, job.last_run_at)
          files.push(...cboeFiles)
          console.log(`Fetched ${cboeFiles.length} CBOE ${venue.toUpperCase()} files`)
        } else if (job.source_type === 'nasdaq') {
          // Nasdaq Nordic has dynamic URLs based on time - fetch all since last run
          const nasdaqFiles = await fetchNasdaqDataSinceLastRun(job.last_run_at)
          files.push(...nasdaqFiles)
          console.log(`Fetched ${nasdaqFiles.length} Nasdaq files`)
        } else {
          // Standard fetch for other sources
          const response = await fetch(job.source_url, {
            headers: { 'Accept': 'application/json, text/csv, */*' }
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          files.push({
            data: await response.text(),
            url: job.source_url,
            fileName: `fetch_${new Date().toISOString()}`
          })
        }

        if (files.length === 0) {
          console.log(`No files found for job ${job.name}`)
          await supabase.from('activity_logs').insert({
            job_id: job.id,
            log_type: 'info',
            message: 'No new files available',
          })
          
          await supabase
            .from('job_configurations')
            .update({ last_status: 'success' })
            .eq('id', job.id)

          results.push({ job_id: job.id, status: 'success', files_count: 0 })
          continue
        }

        let totalInserted = 0
        let filesProcessed = 0

        for (const file of files) {
          const rawData = file.data
          const fileName = file.fileName

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
            console.log(`Skipping duplicate file: ${fileName}`)
            continue
          }

          // Parse trades based on source type
          const contentType = ''
          let trades: TradeRecord[] = []
          
          if (job.source_type === 'cboe' || job.source_type === 'cboe_bxe' || job.source_type === 'cboe_cxe' || job.source_type === 'cboe_dxe') {
            trades = parseCboeData(rawData, job.name)
          } else if (job.source_type === 'nasdaq') {
            trades = parseNasdaqData(rawData, job.name)
          } else if (job.source_type === 'lseg') {
            trades = parseLsegData(rawData, contentType, job.name)
          } else {
            trades = parseGenericData(rawData, contentType, job.name)
          }

          if (trades.length === 0) {
            console.log(`No trades in file: ${fileName}`)
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

          totalInserted += insertedCount
          filesProcessed++
          console.log(`Processed file ${fileName}: ${insertedCount} trades`)
        }

        // Collect processed filenames for logging
        const processedFileNames = files.filter((_, i) => i < filesProcessed).map(f => f.fileName).slice(0, 10)
        const fileListSummary = processedFileNames.length > 0 
          ? `Files: ${processedFileNames.join(', ')}${filesProcessed > 10 ? ` (+${filesProcessed - 10} more)` : ''}`
          : ''

        // Log success
        await supabase.from('activity_logs').insert({
          job_id: job.id,
          log_type: 'success',
          message: `Processed ${filesProcessed} files with ${totalInserted} trades`,
          details: { files_count: filesProcessed, trades_count: totalInserted, files: processedFileNames }
        })

        // Update job status
        await supabase
          .from('job_configurations')
          .update({ last_status: 'success', last_error: null })
          .eq('id', job.id)

        results.push({ job_id: job.id, status: 'success', files_count: filesProcessed, trades_count: totalInserted })

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
// Files are at: https://www.cboe.com/europe/equities/trade_data/{venue}/minute/rts13_public_trade_data_{venue}_{date}_{HHMM}.csv
// Venues: bxe, cxe, dxe, apa
async function fetchCboeDataSinceLastRun(venue: string, lastRunAt: string | null): Promise<FetchedFile[]> {
  const files: FetchedFile[] = []
  
  // Validate venue
  if (!['bxe', 'cxe', 'dxe', 'apa'].includes(venue)) {
    venue = 'bxe' // default
  }

  const now = new Date()
  
  // End time is 5 minutes ago (data delay)
  const endTime = new Date(now.getTime() - 5 * 60 * 1000)
  
  // Determine start time: max of (last_run_at, 2 hours ago)
  // If no last run, go back 2 hours
  let startTime: Date
  if (lastRunAt) {
    const lastRun = new Date(lastRunAt)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    // Use the more recent of: lastRun or twoHoursAgo
    startTime = lastRun > twoHoursAgo ? lastRun : twoHoursAgo
  } else {
    // First run: go back 2 hours
    startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  }
  
  // If start is after end, swap or just try the last 30 mins
  if (startTime >= endTime) {
    startTime = new Date(endTime.getTime() - 30 * 60 * 1000)
  }
  
  console.log(`CBOE ${venue.toUpperCase()}: Fetching files from ${startTime.toISOString()} to ${endTime.toISOString()}`)
  
  // Generate all minute timestamps between start and end
  const currentTime = new Date(startTime)
  const urlsToTry: { url: string; fileName: string }[] = []
  
  while (currentTime <= endTime) {
    const dateStr = currentTime.toISOString().split('T')[0] // YYYY-MM-DD
    const hour = currentTime.getUTCHours().toString().padStart(2, '0')
    const minute = currentTime.getUTCMinutes().toString().padStart(2, '0')
    
    const fileName = `rts13_public_trade_data_${venue}_${dateStr}_${hour}${minute}.csv`
    const url = `https://www.cboe.com/europe/equities/trade_data/${venue}/minute/${fileName}`
    
    urlsToTry.push({ url, fileName })
    
    // Move to next minute
    currentTime.setMinutes(currentTime.getMinutes() + 1)
  }
  
  console.log(`CBOE ${venue.toUpperCase()}: Trying ${urlsToTry.length} URLs`)
  
  // Fetch files in parallel (batch of 10 to speed up)
  for (let i = 0; i < urlsToTry.length; i += 10) {
    const batch = urlsToTry.slice(i, i + 10)
    const results = await Promise.allSettled(
      batch.map(async ({ url, fileName }) => {
        try {
          const response = await fetch(url, {
            headers: { 
              'Accept': 'text/csv, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; TradeDataFetcher/1.0)'
            },
            redirect: 'follow'
          })

          if (response.ok) {
            const data = await response.text()
            // Valid CBOE file has headers
            if (data && data.length > 100 && (data.includes('Timestamp') || data.includes('Symbol'))) {
              return { data, url, fileName }
            }
          }
        } catch (e) {
          // Silently ignore fetch errors for individual files
        }
        return null
      })
    )
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        files.push(result.value)
      }
    }
  }
  
  console.log(`CBOE ${venue.toUpperCase()}: Found ${files.length} valid files`)
  return files
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

// Nasdaq URL pattern: https://tradereports.nasdaq.com/api/regulatory/trade-report/download
// Files are named: NordicEquity-posttrade-{YYYY-MM-DD}T{HHMM}
// IMPORTANT: File names use CET/CEST time (Europe/Stockholm), not UTC!
// Data is 15 minutes delayed and available for 48 hours
async function fetchNasdaqDataSinceLastRun(lastRunAt: string | null): Promise<FetchedFile[]> {
  const files: FetchedFile[] = []
  
  const now = new Date()
  
  // Calculate CET offset (UTC+1 in winter, UTC+2 in summer)
  // For simplicity, check if we're in DST (roughly last Sunday of March to last Sunday of October)
  const year = now.getUTCFullYear()
  const marchLastSunday = new Date(Date.UTC(year, 2, 31))
  marchLastSunday.setUTCDate(31 - marchLastSunday.getUTCDay())
  const octoberLastSunday = new Date(Date.UTC(year, 9, 31))
  octoberLastSunday.setUTCDate(31 - octoberLastSunday.getUTCDay())
  
  const isDST = now >= marchLastSunday && now < octoberLastSunday
  const cetOffset = isDST ? 2 : 1 // CEST = UTC+2, CET = UTC+1
  
  console.log(`Nasdaq: Using CET offset of ${cetOffset} hours (DST: ${isDST})`)
  
  // Nasdaq files are 15 min delayed, so we look for files from 20-120 mins ago
  const endTime = new Date(now.getTime() - 20 * 60 * 1000)
  
  // Determine start time
  let startTime: Date
  if (lastRunAt) {
    const lastRun = new Date(lastRunAt)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    startTime = lastRun > twoHoursAgo ? lastRun : twoHoursAgo
    startTime = new Date(startTime.getTime() - 15 * 60 * 1000)
  } else {
    startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  }
  
  if (startTime >= endTime) {
    startTime = new Date(endTime.getTime() - 60 * 60 * 1000)
  }
  
  console.log(`Nasdaq: UTC time window from ${startTime.toISOString()} to ${endTime.toISOString()}`)
  
  // Nasdaq API endpoint for downloading trade reports
  const baseUrl = 'https://tradereports.nasdaq.com/api/regulatory/trade-report/download'
  
  // Generate all minute timestamps between start and end, converted to CET for filename
  const currentTime = new Date(startTime)
  const urlsToTry: { url: string; fileName: string }[] = []
  
  while (currentTime <= endTime) {
    // Convert UTC to CET for filename
    const cetTime = new Date(currentTime.getTime() + cetOffset * 60 * 60 * 1000)
    const dateStr = cetTime.toISOString().split('T')[0] // YYYY-MM-DD in CET
    const hour = cetTime.getUTCHours().toString().padStart(2, '0')
    const minute = cetTime.getUTCMinutes().toString().padStart(2, '0')
    
    const fileName = `NordicEquity-posttrade-${dateStr}T${hour}${minute}`
    const url = `${baseUrl}?type=POST_TRADE&assetClass=EQUITY&fileName=${fileName}`
    
    urlsToTry.push({ url, fileName })
    
    // Move to next minute
    currentTime.setMinutes(currentTime.getMinutes() + 1)
  }
  
  console.log(`Nasdaq: Trying ${urlsToTry.length} URLs (first: ${urlsToTry[0]?.fileName}, last: ${urlsToTry[urlsToTry.length-1]?.fileName})`)
  
  // Fetch files in parallel (batch of 10 to speed up)
  for (let i = 0; i < urlsToTry.length; i += 10) {
    const batch = urlsToTry.slice(i, i + 10)
    const results = await Promise.allSettled(
      batch.map(async ({ url, fileName }) => {
        try {
          const response = await fetch(url, {
            headers: { 
              'Accept': 'text/csv, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; TradeDataFetcher/1.0)'
            },
            redirect: 'follow'
          })

          if (response.ok) {
            const data = await response.text()
            // Nasdaq files must have actual trade data (more than just "sep=;" header)
            if (data && data.includes('Trading date and time') && data.split('\n').length > 3) {
              console.log(`Nasdaq: Found valid file ${fileName} with ${data.split('\n').length} lines`)
              return { data, url, fileName }
            }
          }
        } catch (e) {
          // Silently ignore fetch errors
        }
        return null
      })
    )
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        files.push(result.value)
      }
    }
  }
  
  console.log(`Nasdaq: Found ${files.length} valid files`)
  return files
}

// Parse Nasdaq Nordic CSV format (semicolon-separated)
// Columns: Trading date and time;Instrument identification code;Publication date and time;Price currency;
//          Venue of execution;Venue of publication;Price notation;Transaction to be cleared;MMT flag;
//          Transaction identification code;Trade type;Price;Quantity;Buyer;Seller;...
function parseNasdaqData(rawData: string, jobName: string): TradeRecord[] {
  const trades: TradeRecord[] = []
  
  try {
    const lines = rawData.split('\n').filter(line => line.trim())
    
    if (lines.length < 3) {
      console.log('Nasdaq: No data lines found')
      return trades
    }

    // Skip the "sep=;" line if present
    let headerLineIdx = 0
    if (lines[0].includes('sep=')) {
      headerLineIdx = 1
    }

    // Parse header to find column indices
    const headers = lines[headerLineIdx].split(';').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    console.log(`Nasdaq headers: ${headers.slice(0, 10).join(', ')}...`)
    
    const indices = {
      tradingDateTime: headers.findIndex(h => h === 'trading_date_and_time'),
      symbol: headers.findIndex(h => h === 'instrument_identification_code'),
      price: headers.findIndex(h => h === 'price'),
      quantity: headers.findIndex(h => h === 'quantity'),
      venue: headers.findIndex(h => h === 'venue_of_execution'),
      currency: headers.findIndex(h => h === 'price_currency'),
      mmtFlag: headers.findIndex(h => h === 'mmt_flag'),
      transactionId: headers.findIndex(h => h === 'transaction_identification_code'),
      tradeType: headers.findIndex(h => h === 'trade_type'),
    }

    console.log(`Nasdaq column indices: symbol=${indices.symbol}, price=${indices.price}, qty=${indices.quantity}`)

    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const values = lines[i].split(';').map(v => v.trim())
      
      if (values.length < 10) continue

      const symbol = indices.symbol >= 0 ? values[indices.symbol] : ''
      const priceStr = indices.price >= 0 ? values[indices.price] : '0'
      const qtyStr = indices.quantity >= 0 ? values[indices.quantity] : '0'
      const tradeTime = indices.tradingDateTime >= 0 ? values[indices.tradingDateTime] : new Date().toISOString()
      const venue = indices.venue >= 0 ? values[indices.venue] : 'NASDAQ'
      
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
        venue: venue || 'NASDAQ',
        market_mechanism: indices.mmtFlag >= 0 ? values[indices.mmtFlag] : undefined,
        trading_mode: indices.tradeType >= 0 ? values[indices.tradeType] : undefined,
        transaction_id: indices.transactionId >= 0 ? values[indices.transactionId] : undefined,
      })
    }

    console.log(`Nasdaq: Parsed ${trades.length} trades from ${lines.length - headerLineIdx - 1} lines`)
  } catch (e) {
    console.error(`Failed to parse Nasdaq data for ${jobName}: ${e}`)
  }
  
  return trades
}

// Helper to parse CSV lines properly (handles quoted fields with commas)
function parseCSVLine(line: string, separator: string = ','): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === separator && !inQuotes) {
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
