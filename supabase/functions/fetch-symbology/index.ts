import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SymbolRecord {
  symbol: string
  isin?: string
  name?: string
  currency?: string
  venue: string
  source: string
  mic?: string
  segment?: string
  tick_table?: string
  raw_data?: Record<string, unknown>
}

// CBOE Europe TRF (Trade Reporting Facility) symbol listing URL
const CBOE_TRF_URL = 'https://www.batstrading.co.uk/trf/market_data/symbol_listing/csv/'

// Check if current time is within European market hours (Mon-Fri, 07:00-23:00 CET)
function isWithinMarketHours(): { withinHours: boolean; reason?: string } {
  const now = new Date()
  
  // Get current time in CET/CEST (Europe/Helsinki is EET, use Berlin for CET)
  const cetTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }))
  const dayOfWeek = cetTime.getDay() // 0 = Sunday, 6 = Saturday
  const hour = cetTime.getHours()
  
  // Weekend check (Saturday = 6, Sunday = 0)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { withinHours: false, reason: `Weekend (${dayOfWeek === 0 ? 'Sunday' : 'Saturday'}) - no files published` }
  }
  
  // Market hours: 07:00 CET (Helsinki opens early) to 23:00 CET
  if (hour < 7) {
    return { withinHours: false, reason: `Before market open (${hour}:00 CET, opens at 07:00 CET)` }
  }
  
  if (hour >= 23) {
    return { withinHours: false, reason: `After market close (${hour}:00 CET, closes at 23:00 CET)` }
  }
  
  return { withinHours: true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await req.json().catch(() => ({}))
    const forceRun = body.force === true
    
    // Check market hours unless force flag is set
    if (!forceRun) {
      const marketCheck = isWithinMarketHours()
      if (!marketCheck.withinHours) {
        console.log(`Skipping fetch: ${marketCheck.reason}`)
        
        await supabase.from('activity_logs').insert({
          log_type: 'info',
          message: `Symbology fetch skipped: ${marketCheck.reason}`,
          details: { source: 'CBOE_TRF', skipped: true }
        })
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            skipped: true, 
            reason: marketCheck.reason 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }
    
    console.log(`Fetching CBOE TRF symbology from: ${CBOE_TRF_URL}`)
    
    const response = await fetch(CBOE_TRF_URL, {
      headers: {
        'Accept': 'text/csv, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; TradeDataFetcher/1.0)'
      }
    })
    
    if (!response.ok) {
      const errorMsg = `Failed to fetch TRF symbols: HTTP ${response.status}`
      console.error(errorMsg)
      
      await supabase.from('activity_logs').insert({
        log_type: 'error',
        message: errorMsg,
        details: { source: 'CBOE_TRF', status: response.status }
      })
      
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const csvData = await response.text()
    const symbols = parseCboeSymbolCsv(csvData, 'TRF')
    
    if (symbols.length === 0) {
      console.log('No symbols found in TRF data')
      
      await supabase.from('activity_logs').insert({
        log_type: 'warning',
        message: 'No symbols found in CBOE TRF data',
        details: { source: 'CBOE_TRF' }
      })
      
      return new Response(
        JSON.stringify({ success: true, count: 0, message: 'No symbols found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Upsert symbols in batches
    const batchSize = 500
    let upsertedCount = 0
    let errorCount = 0
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize)
      
      const { error } = await supabase
        .from('symbology')
        .upsert(batch, { 
          onConflict: 'symbol,venue,source',
          ignoreDuplicates: false 
        })
      
      if (error) {
        console.error(`Upsert error: ${error.message}`)
        errorCount++
      } else {
        upsertedCount += batch.length
      }
    }
    
    console.log(`Upserted ${upsertedCount} TRF symbols`)
    
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `CBOE TRF symbology fetch completed: ${upsertedCount} symbols`,
      details: { 
        source: 'CBOE_TRF', 
        venue: 'TRF',
        count: upsertedCount,
        errors: errorCount
      }
    })
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        venue: 'TRF',
        count: upsertedCount,
        errors: errorCount
      }),
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

// Parse CBOE symbol listing CSV
// Expected columns: Symbol,ISIN,Name,Currency,MIC,Segment,TickTable,...
function parseCboeSymbolCsv(csvData: string, venue: string): SymbolRecord[] {
  const symbols: SymbolRecord[] = []
  
  try {
    const lines = csvData.split('\n').filter(line => line.trim())
    
    if (lines.length < 2) {
      console.log('No data lines in symbol CSV')
      return symbols
    }
    
    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    console.log(`Symbol CSV headers: ${headers.slice(0, 10).join(', ')}`)
    
    const indices = {
      symbol: headers.findIndex(h => h === 'symbol' || h === 'ticker'),
      isin: headers.findIndex(h => h === 'isin'),
      name: headers.findIndex(h => h === 'name' || h === 'company' || h === 'security_name'),
      currency: headers.findIndex(h => h === 'currency' || h === 'ccy'),
      mic: headers.findIndex(h => h === 'mic' || h === 'market'),
      segment: headers.findIndex(h => h === 'segment' || h === 'market_segment'),
      tickTable: headers.findIndex(h => h === 'tick_table' || h === 'ticktable'),
    }
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      
      const symbol = indices.symbol >= 0 ? values[indices.symbol]?.trim() : ''
      if (!symbol) continue
      
      symbols.push({
        symbol,
        isin: indices.isin >= 0 ? values[indices.isin]?.trim() || undefined : undefined,
        name: indices.name >= 0 ? values[indices.name]?.trim() || undefined : undefined,
        currency: indices.currency >= 0 ? values[indices.currency]?.trim() || undefined : undefined,
        venue,
        source: 'CBOE',
        mic: indices.mic >= 0 ? values[indices.mic]?.trim() || undefined : undefined,
        segment: indices.segment >= 0 ? values[indices.segment]?.trim() || undefined : undefined,
        tick_table: indices.tickTable >= 0 ? values[indices.tickTable]?.trim() || undefined : undefined,
      })
    }
    
    console.log(`Parsed ${symbols.length} symbols from CSV`)
  } catch (e) {
    console.error(`Failed to parse symbol CSV: ${e}`)
  }
  
  return symbols
}

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
