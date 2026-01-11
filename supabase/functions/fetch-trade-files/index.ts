import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JobConfiguration {
  id: string
  name: string
  source_url: string
  source_type: 'cboe' | 'cboe_bxe' | 'cboe_cxe' | 'cboe_dxe' | 'cboe_sis' | 'nasdaq' | 'lseg' | 'lseg_trqx' | 'lseg_tqex' | 'lseg_xlon' | 'custom'
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
  currency?: string
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
    const { job_id, source_type } = await req.json().catch(() => ({}))

    // Fetch enabled jobs (filter by job_id or source_type if provided)
    let query = supabase
      .from('job_configurations')
      .select('*')
      .eq('is_enabled', true)
    
    if (job_id) {
      query = query.eq('id', job_id)
    }
    
    if (source_type) {
      query = query.eq('source_type', source_type)
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
        // Skip SIS jobs early - they use fetch-symbology function instead
        if (job.source_type === 'cboe_sis') {
          console.log(`Skipping SIS job ${job.name} - handled by fetch-symbology`)
          results.push({ job_id: job.id, status: 'skipped', reason: 'handled by fetch-symbology' })
          continue
        }

        // Log start
        await supabase.from('activity_logs').insert({
          job_id: job.id,
          log_type: 'info',
          message: `Starting fetch for ${job.name}`,
          details: { source_url: job.source_url }
        })

        // Fetch all files since last run
        const files: FetchedFile[] = []
        
        if (job.source_type === 'cboe' || job.source_type === 'cboe_bxe' || job.source_type === 'cboe_cxe' || job.source_type === 'cboe_dxe') {
          // CBOE has dynamic URLs based on venue and time - fetch all since last run
          const venue = job.source_type.replace('cboe_', '') === 'cboe' ? 'bxe' : job.source_type.replace('cboe_', '')
          const cboeFiles = await fetchCboeDataSinceLastRun(venue, job.last_run_at)
          files.push(...cboeFiles)
          console.log(`Fetched ${cboeFiles.length} CBOE ${venue.toUpperCase()} files`)
        } else if (job.source_type === 'nasdaq') {
          // Nasdaq Nordic - fetch file list from page and download new ones
          const nasdaqFiles = await fetchNasdaqDataSinceLastRun(job.last_run_at, supabase, job.id)
          files.push(...nasdaqFiles)
          console.log(`Fetched ${nasdaqFiles.length} Nasdaq files`)
        } else if (job.source_type === 'lseg_trqx' || job.source_type === 'lseg_tqex' || job.source_type === 'lseg_xlon') {
          // LSEG - scrape DMD page for file links
          const lsegFiles = await fetchLsegDataSinceLastRun(job.source_url, supabase, job.id)
          files.push(...lsegFiles)
          console.log(`Fetched ${lsegFiles.length} LSEG files`)
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
            details: { reason: 'No matching files found or all files already processed' }
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
        let emptyFilesCount = 0
        let filteredTradesCount = 0
        const processedFileDetails: { name: string; lines: number; trades: number; filtered: number }[] = []

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
          let parseResult: { trades: TradeRecord[]; totalLines: number; filteredCount: number } = { trades: [], totalLines: 0, filteredCount: 0 }
          
          if (job.source_type === 'cboe' || job.source_type === 'cboe_bxe' || job.source_type === 'cboe_cxe' || job.source_type === 'cboe_dxe') {
            parseResult = parseCboeDataWithStats(rawData, job.name)
          } else if (job.source_type === 'nasdaq') {
            parseResult = parseNasdaqDataWithStats(rawData, job.name)
          } else if (job.source_type === 'lseg') {
            parseResult.trades = parseLsegData(rawData, contentType, job.name)
          } else if (job.source_type === 'lseg_trqx' || job.source_type === 'lseg_tqex' || job.source_type === 'lseg_xlon') {
            parseResult = parseLsegPostTradeDataWithStats(rawData, job.name)
          } else {
            parseResult.trades = parseGenericData(rawData, contentType, job.name)
          }

          const trades = parseResult.trades
          filteredTradesCount += parseResult.filteredCount

          if (trades.length === 0) {
            // Track if file had data lines but no valid trades
            if (parseResult.totalLines > 1) {
              console.log(`File ${fileName}: ${parseResult.totalLines} data lines, but 0 valid trades (${parseResult.filteredCount} filtered)`)
              emptyFilesCount++
              processedFileDetails.push({ name: fileName, lines: parseResult.totalLines, trades: 0, filtered: parseResult.filteredCount })
            } else {
              console.log(`File ${fileName}: empty or header-only`)
              emptyFilesCount++
            }
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
          processedFileDetails.push({ name: fileName, lines: parseResult.totalLines, trades: insertedCount, filtered: 0 })
          console.log(`Processed file ${fileName}: ${insertedCount} trades`)
        }

        // Collect processed filenames for logging
        const processedFileNames = processedFileDetails.filter(f => f.trades > 0).map(f => f.name).slice(0, 10)

        // Log success with detailed breakdown
        const logMessage = emptyFilesCount > 0
          ? `Processed ${filesProcessed} files with ${totalInserted} trades (${emptyFilesCount} files had no valid trades)`
          : `Processed ${filesProcessed} files with ${totalInserted} trades`
        
        await supabase.from('activity_logs').insert({
          job_id: job.id,
          log_type: 'success',
          message: logMessage,
          details: { 
            files_count: filesProcessed, 
            trades_count: totalInserted, 
            empty_files: emptyFilesCount,
            filtered_trades: filteredTradesCount,
            files: processedFileNames,
            file_details: processedFileDetails.slice(0, 20) // Include details for first 20 files
          }
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

    // Note: Candle updates are now handled by database trigger (tr_update_candle_on_trade)

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
  return parseCboeDataWithStats(rawData, jobName).trades
}

function parseCboeDataWithStats(rawData: string, jobName: string): { trades: TradeRecord[]; totalLines: number; filteredCount: number } {
  const trades: TradeRecord[] = []
  let filteredCount = 0
  
  try {
    const lines = rawData.split('\n').filter(line => line.trim())
    
    if (lines.length < 2) {
      console.log('CBOE: No data lines found')
      return { trades, totalLines: 0, filteredCount: 0 }
    }

    // Parse header to find column indices
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    console.log(`CBOE headers: ${headers.slice(0, 10).join(', ')}...`)
    
    const indices = {
      timestamp: headers.findIndex(h => h === 'timestamp'),
      tradingDateTime: headers.findIndex(h => h === 'trading_date_time'),
      symbol: headers.findIndex(h => h === 'symbol'),
      price: headers.findIndex(h => h === 'price'),
      priceCurrency: headers.findIndex(h => h === 'price_currency'),
      executedShares: headers.findIndex(h => h === 'executed_shares'),
      executionVenue: headers.findIndex(h => h === 'execution_venue'),
      marketMechanism: headers.findIndex(h => h === 'market_mechanism'),
      tradingMode: headers.findIndex(h => h === 'trading_mode'),
      tradeId: headers.findIndex(h => h === 'trade_id'),
    }

    console.log(`CBOE column indices: symbol=${indices.symbol}, price=${indices.price}, qty=${indices.executedShares}`)

    const totalDataLines = lines.length - 1
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      
      if (values.length < 7) continue

      const symbol = indices.symbol >= 0 ? values[indices.symbol]?.trim() : ''
      const priceStr = indices.price >= 0 ? values[indices.price]?.trim() : '0'
      const qtyStr = indices.executedShares >= 0 ? values[indices.executedShares]?.trim() : '0'
      // Use 'Trading Date Time' column which has full ISO timestamp
      // The 'Timestamp' column only contains time without date (e.g., "08:16:00")
      const rawTradingDateTime = indices.tradingDateTime >= 0 ? values[indices.tradingDateTime]?.trim() : null
      const rawTimestamp = indices.timestamp >= 0 ? values[indices.timestamp]?.trim() : null
      // Prefer Trading Date Time (full ISO timestamp) over bare Timestamp (time-only)
      const tradeTime = rawTradingDateTime || 
        (rawTimestamp && rawTimestamp.includes('-') ? rawTimestamp : null) || 
        new Date().toISOString()
      const venue = indices.executionVenue >= 0 ? values[indices.executionVenue]?.trim() : 'CBOE'
      
      // Skip if missing required fields
      if (!symbol || symbol === '') continue
      
      const price = parseFloat(priceStr) || 0
      const quantity = parseFloat(qtyStr) || 0
      
      // Skip zero-price or zero-quantity trades
      if (price === 0 || quantity === 0) {
        filteredCount++
        continue
      }

      trades.push({
        symbol,
        price,
        quantity,
        trade_time: tradeTime,
        venue: venue || 'CBOE',
        currency: indices.priceCurrency >= 0 ? values[indices.priceCurrency]?.trim() : undefined,
        market_mechanism: indices.marketMechanism >= 0 ? values[indices.marketMechanism]?.trim() : undefined,
        trading_mode: indices.tradingMode >= 0 ? values[indices.tradingMode]?.trim() : undefined,
        transaction_id: indices.tradeId >= 0 ? values[indices.tradeId]?.trim() : undefined,
      })
    }

    console.log(`CBOE: Parsed ${trades.length} trades from ${totalDataLines} lines (${filteredCount} filtered)`)
    return { trades, totalLines: totalDataLines, filteredCount }
  } catch (e) {
    console.error(`Failed to parse CBOE data for ${jobName}: ${e}`)
  }
  
  return { trades, totalLines: 0, filteredCount }
}

// Nasdaq: Files are available for 48 hours with 15 min delay
// File names use local Stockholm time (CET/CEST)
// Since we can't scrape the JS-rendered page, generate all possible filenames for today
async function fetchNasdaqDataSinceLastRun(lastRunAt: string | null, supabase: any, jobId: string): Promise<FetchedFile[]> {
  const files: FetchedFile[] = []
  
  try {
    // Get already processed files for this job
    const { data: processedFiles } = await supabase
      .from('processed_files')
      .select('file_name')
      .eq('job_id', jobId)
    
    const processedSet = new Set((processedFiles || []).map((f: { file_name: string }) => f.file_name))
    console.log(`Nasdaq: ${processedSet.size} files already processed`)
    
    const now = new Date()
    
    // Calculate Stockholm time (CET = UTC+1, CEST = UTC+2)
    const year = now.getUTCFullYear()
    const marchLastSunday = new Date(Date.UTC(year, 2, 31))
    marchLastSunday.setUTCDate(31 - marchLastSunday.getUTCDay())
    const octoberLastSunday = new Date(Date.UTC(year, 9, 31))
    octoberLastSunday.setUTCDate(31 - octoberLastSunday.getUTCDay())
    const isDST = now >= marchLastSunday && now < octoberLastSunday
    const stockholmOffset = isDST ? 2 : 1
    
    // Stockholm time now
    const stockholmNow = new Date(now.getTime() + stockholmOffset * 60 * 60 * 1000)
    
    // Files are available from market open (08:00) to 15 mins ago
    // Generate files for today only, from 08:00 Stockholm to current time - 15 mins
    const todayStr = stockholmNow.toISOString().split('T')[0]
    
    // End at current Stockholm time minus 15 mins
    const endHour = stockholmNow.getUTCHours()
    const endMinute = stockholmNow.getUTCMinutes() - 15
    
    const urlsToTry: { url: string; fileName: string }[] = []
    const baseUrl = 'https://tradereports.nasdaq.com/api/regulatory/trade-report/download'
    
    // Generate from 08:00 to end time
    for (let h = 8; h <= endHour; h++) {
      const maxMin = (h === endHour) ? Math.max(0, endMinute) : 59
      const startMin = 0
      
      for (let m = startMin; m <= maxMin; m++) {
        const hourStr = h.toString().padStart(2, '0')
        const minStr = m.toString().padStart(2, '0')
        const fileName = `NordicEquity-posttrade-${todayStr}T${hourStr}${minStr}`
        
        // Skip already processed files
        if (processedSet.has(fileName)) continue
        
        const url = `${baseUrl}?type=POST_TRADE&assetClass=EQUITY&fileName=${fileName}`
        urlsToTry.push({ url, fileName })
      }
    }
    
    console.log(`Nasdaq: Trying ${urlsToTry.length} new files for ${todayStr}`)
    
    let notFoundCount = 0
    let errorCount = 0
    
    // Fetch files in smaller batches with delay to avoid rate limiting
    for (let i = 0; i < urlsToTry.length; i += 3) {
      const batch = urlsToTry.slice(i, i + 3)
      const results = await Promise.allSettled(
        batch.map(async ({ url, fileName }) => {
          try {
            const response = await fetch(url, {
              headers: { 
                'Accept': 'text/csv,text/plain,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://tradereports.nasdaq.com/',
                'Origin': 'https://tradereports.nasdaq.com',
              }
            })

            if (response.ok) {
              const data = await response.text()
              // Only accept files with actual trade data (more than header + sep line)
              const lines = data.split('\n').filter(l => l.trim())
              if (data.includes('Trading date and time') && lines.length > 2) {
                console.log(`Nasdaq: Found ${fileName} (${lines.length} lines)`)
                return { data, url, fileName }
              } else {
                notFoundCount++
              }
            } else {
              if (response.status !== 404) {
                errorCount++
                console.log(`Nasdaq: HTTP ${response.status} for ${fileName}`)
              } else {
                notFoundCount++
              }
            }
          } catch (e) {
            errorCount++
            console.log(`Nasdaq: Error fetching ${fileName}: ${e}`)
          }
          return null
        })
      )
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          files.push(result.value)
        }
      }
      
      // Longer delay between batches to avoid rate limiting
      if (i + 3 < urlsToTry.length) {
        await new Promise(r => setTimeout(r, 500))
      }
    }
    
    console.log(`Nasdaq: Found ${files.length}, not found ${notFoundCount}, errors ${errorCount}`)
    
    console.log(`Nasdaq: Downloaded ${files.length} valid files`)
  } catch (e) {
    console.error(`Nasdaq: Error: ${e}`)
  }
  
  return files
}

// Parse Nasdaq Nordic CSV format (semicolon-separated)
// Columns: Trading date and time;Instrument identification code;Publication date and time;Price currency;
//          Venue of execution;Venue of publication;Price notation;Transaction to be cleared;MMT flag;
//          Transaction identification code;Trade type;Price;Quantity;Buyer;Seller;...
function parseNasdaqData(rawData: string, jobName: string): TradeRecord[] {
  return parseNasdaqDataWithStats(rawData, jobName).trades
}

function parseNasdaqDataWithStats(rawData: string, jobName: string): { trades: TradeRecord[]; totalLines: number; filteredCount: number } {
  const trades: TradeRecord[] = []
  let filteredCount = 0
  
  try {
    const lines = rawData.split('\n').filter(line => line.trim())
    
    if (lines.length < 3) {
      console.log('Nasdaq: No data lines found')
      return { trades, totalLines: 0, filteredCount: 0 }
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

    const totalDataLines = lines.length - headerLineIdx - 1
    
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
      if (price === 0 || quantity === 0) {
        filteredCount++
        continue
      }

      trades.push({
        symbol,
        price,
        quantity,
        trade_time: tradeTime,
        venue: venue || 'NASDAQ',
        currency: indices.currency >= 0 ? values[indices.currency] : undefined,
        market_mechanism: indices.mmtFlag >= 0 ? values[indices.mmtFlag] : undefined,
        trading_mode: indices.tradeType >= 0 ? values[indices.tradeType] : undefined,
        transaction_id: indices.transactionId >= 0 ? values[indices.transactionId] : undefined,
      })
    }

    console.log(`Nasdaq: Parsed ${trades.length} trades from ${totalDataLines} lines (${filteredCount} filtered)`)
    return { trades, totalLines: totalDataLines, filteredCount }
  } catch (e) {
    console.error(`Failed to parse Nasdaq data for ${jobName}: ${e}`)
  }
  
  return { trades, totalLines: 0, filteredCount }
}

// LSEG DMD: Generate URLs programmatically (site is an Angular SPA, HTML scraping doesn't work)
// File patterns:
//   End-of-day: XXXX-post-YYYY-MM-DD.csv.gz (consolidated, priority)
//   Intraday: XXXX-post-YYYY-MM-DDTHH_MM.csv
async function fetchLsegDataSinceLastRun(sourceUrl: string, supabase: any, jobId: string): Promise<FetchedFile[]> {
  console.log(`LSEG fetchLsegDataSinceLastRun called with sourceUrl: ${sourceUrl}`)
  const files: FetchedFile[] = []
  
  try {
    // Determine venue code (MIC) for filename from source URL
    // Files are served directly from root: https://dmd.lseg.com/XXXX-post-...
    let venueCode = 'TRQX'
    if (sourceUrl.includes('TurquoiseUK')) venueCode = 'TRQX'
    else if (sourceUrl.includes('TurquoiseEurope')) venueCode = 'TQEX'
    else if (sourceUrl.includes('LSE')) venueCode = 'XLON'
    
    console.log(`LSEG: Using venue code ${venueCode}`)
    
    // Get already processed files for this job
    const { data: processedFiles } = await supabase
      .from('processed_files')
      .select('file_name')
      .eq('job_id', jobId)
    
    const processedSet = new Set((processedFiles || []).map((f: { file_name: string }) => f.file_name))
    console.log(`LSEG: ${processedSet.size} files already processed`)
    
    const now = new Date()
    // LSEG files are served directly from root
    const LSEG_FILE_BASE = 'https://dmd.lseg.com/'
    
    // LSEG uses UTC times for file names
    const todayStr = now.toISOString().split('T')[0]
    const currentHour = now.getUTCHours()
    const currentMinute = now.getUTCMinutes()
    
    // Generate intraday file URLs for today (07:00 to current time - 2 minutes)
    const urlsToTry: { url: string; fileName: string }[] = []
    
    // Market hours: approximately 07:00-17:00 UTC
    const marketOpen = 7
    const marketClose = 17
    
    for (let h = marketOpen; h <= Math.min(currentHour, marketClose); h++) {
      // LSEG data is delayed by 15 minutes, so don't try files from last 16 minutes
      const maxMin = (h === currentHour) ? Math.max(0, currentMinute - 16) : 59
      
      for (let m = 0; m <= maxMin; m++) {
        const hourStr = h.toString().padStart(2, '0')
        const minStr = m.toString().padStart(2, '0')
        const fileName = `${venueCode}-post-${todayStr}T${hourStr}_${minStr}.csv`
        
        // Skip already processed
        if (processedSet.has(fileName)) continue
        
        const url = `${LSEG_FILE_BASE}${fileName}`
        urlsToTry.push({ url, fileName })
      }
    }
    
    // Also try yesterday's end-of-day consolidated file
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const eodFileName = `${venueCode}-post-${yesterdayStr}.csv.gz`
    
    if (!processedSet.has(eodFileName)) {
      urlsToTry.push({
        url: `${LSEG_FILE_BASE}${eodFileName}`,
        fileName: eodFileName
      })
    }
    
    console.log(`LSEG ${venueCode}: Trying ${urlsToTry.length} URLs`)
    if (urlsToTry.length > 0) {
      console.log(`LSEG: First URL attempt: ${urlsToTry[0].url}`)
    }
    
    // Fetch files in batches of 5
    for (let i = 0; i < urlsToTry.length; i += 5) {
      const batch = urlsToTry.slice(i, i + 5)
      
      // Log first URL of each batch for debugging
      if (i === 0) {
        console.log(`LSEG: Trying first URL: ${batch[0]?.url}`)
      }
      
      const results = await Promise.allSettled(
        batch.map(async ({ url, fileName }) => {
          try {
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/csv,application/gzip,*/*',
              }
            })
            
            // Log response status for first few attempts
            if (i === 0) {
              console.log(`LSEG: ${fileName} -> HTTP ${response.status}`)
            }
            
            if (response.ok) {
              // Handle gzip files
              if (fileName.endsWith('.gz')) {
                const buffer = await response.arrayBuffer()
                const decompressed = await decompressGzip(new Uint8Array(buffer))
                if (decompressed && decompressed.length > 100) {
                  console.log(`LSEG: Found ${fileName} (${decompressed.split('\n').length} lines)`)
                  return { data: decompressed, url, fileName }
                }
              } else {
                const data = await response.text()
                if (data && data.length > 100 && !data.includes('<!DOCTYPE')) {
                  console.log(`LSEG: Found ${fileName} (${data.split('\n').length} lines)`)
                  return { data, url, fileName }
                }
              }
            }
          } catch (e) {
            // Log first error only
            if (i === 0) {
              console.log(`LSEG: Error fetching ${fileName}: ${e}`)
            }
          }
          return null
        })
      )
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          files.push(result.value)
        }
      }
      
      // Small delay between batches
      if (i + 5 < urlsToTry.length) {
        await new Promise(r => setTimeout(r, 200))
      }
    }
    
    console.log(`LSEG: Downloaded ${files.length} files`)
  } catch (e) {
    console.error(`LSEG fetch error: ${e}`)
  }
  
  return files
}

// Helper to decompress gzip data
async function decompressGzip(compressedData: Uint8Array): Promise<string> {
  try {
    const stream = new DecompressionStream('gzip')
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(compressedData)
        controller.close()
      }
    }).pipeThrough(stream)
    
    const reader = readable.getReader()
    const chunks: Uint8Array[] = []
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    
    return new TextDecoder().decode(result)
  } catch (e) {
    console.error('Gzip decompression failed:', e)
    return ''
  }
}

// Helper to fetch and decompress gzipped files
async function fetchAndDecompressGz(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }
    })
    if (!response.ok) {
      console.error(`LSEG: Failed to fetch ${url}: ${response.status}`)
      return null
    }
    
    const gzBuffer = await response.arrayBuffer()
    
    // Use DecompressionStream for gzip decompression
    const decompressed = new DecompressionStream('gzip')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(gzBuffer))
        controller.close()
      }
    }).pipeThrough(decompressed)
    
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    
    // Combine chunks and decode
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    
    const decoder = new TextDecoder('utf-8')
    return decoder.decode(combined)
  } catch (e) {
    console.error(`Failed to decompress ${url}: ${e}`)
    return null
  }
}

// Parse LSEG post-trade CSV format (semicolon-separated)
// Columns based on sample file:
// Trading date and time;Instrument identification code;Price;Price currency;
// Price notation;Quantity;Venue of execution;Publication date and time;
// Venue of Publication;Transaction identification code;Flags
function parseLsegPostTradeData(rawData: string, jobName: string): TradeRecord[] {
  return parseLsegPostTradeDataWithStats(rawData, jobName).trades
}

function parseLsegPostTradeDataWithStats(rawData: string, jobName: string): { trades: TradeRecord[]; totalLines: number; filteredCount: number } {
  const trades: TradeRecord[] = []
  let filteredCount = 0
  
  try {
    const lines = rawData.split('\n').filter(line => line.trim())
    
    if (lines.length < 2) {
      console.log('LSEG: No data lines found')
      return { trades, totalLines: 0, filteredCount: 0 }
    }

    // Skip the "sep=;" line if present
    let headerLineIdx = 0
    if (lines[0].includes('sep=')) {
      headerLineIdx = 1
    }

    // Parse header to find column indices
    const headers = lines[headerLineIdx].split(';').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    console.log(`LSEG headers: ${headers.slice(0, 8).join(', ')}...`)
    
    // Map columns based on the sample file format
    const indices = {
      tradingDateTime: headers.findIndex(h => h === 'trading_date_and_time'),
      symbol: headers.findIndex(h => h === 'instrument_identification_code'),
      price: headers.findIndex(h => h === 'price'),
      currency: headers.findIndex(h => h === 'price_currency'),
      quantity: headers.findIndex(h => h === 'quantity'),
      venue: headers.findIndex(h => h === 'venue_of_execution'),
      transactionId: headers.findIndex(h => h === 'transaction_identification_code'),
      flags: headers.findIndex(h => h === 'flags'),
    }

    console.log(`LSEG column indices: symbol=${indices.symbol}, price=${indices.price}, qty=${indices.quantity}, venue=${indices.venue}`)

    const totalDataLines = lines.length - headerLineIdx - 1
    
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const values = lines[i].split(';').map(v => v.trim())
      
      if (values.length < 7) continue

      const symbol = indices.symbol >= 0 ? values[indices.symbol] : ''
      const priceStr = indices.price >= 0 ? values[indices.price] : '0'
      const qtyStr = indices.quantity >= 0 ? values[indices.quantity] : '0'
      const tradeTime = indices.tradingDateTime >= 0 ? values[indices.tradingDateTime] : new Date().toISOString()
      const venue = indices.venue >= 0 ? values[indices.venue] : 'LSEG'
      
      // Skip if missing required fields
      if (!symbol || symbol === '') continue
      
      const price = parseFloat(priceStr) || 0
      const quantity = parseFloat(qtyStr) || 0
      
      // Skip zero-price or zero-quantity trades
      if (price === 0 || quantity === 0) {
        filteredCount++
        continue
      }

      trades.push({
        symbol,
        price,
        quantity,
        trade_time: tradeTime,
        venue: venue || 'LSEG',
        currency: indices.currency >= 0 ? values[indices.currency] : undefined,
        market_mechanism: indices.flags >= 0 ? values[indices.flags] : undefined,
        transaction_id: indices.transactionId >= 0 ? values[indices.transactionId] : undefined,
      })
    }

    console.log(`LSEG: Parsed ${trades.length} trades from ${totalDataLines} lines (${filteredCount} filtered)`)
    return { trades, totalLines: totalDataLines, filteredCount }
  } catch (e) {
    console.error(`Failed to parse LSEG data for ${jobName}: ${e}`)
  }
  
  return { trades, totalLines: 0, filteredCount }
}
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
