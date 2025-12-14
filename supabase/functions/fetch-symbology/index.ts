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

// CBOE Europe venues and their symbol listing URLs
const CBOE_VENUES = {
  bxe: 'https://www.batstrading.co.uk/bxe/market_data/symbol_listing/csv/',
  cxe: 'https://www.batstrading.co.uk/cxe/market_data/symbol_listing/csv/',
  dxe: 'https://www.batstrading.co.uk/dxe/market_data/symbol_listing/csv/',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { source, venue } = await req.json().catch(() => ({ source: 'cboe', venue: 'all' }))
    
    console.log(`Fetching symbology from source: ${source}, venue: ${venue}`)
    
    const results: { venue: string; count: number; status: string }[] = []
    
    if (source === 'cboe' || source === 'all') {
      const venuesToFetch = venue === 'all' 
        ? Object.keys(CBOE_VENUES) 
        : [venue]
      
      for (const v of venuesToFetch) {
        const url = CBOE_VENUES[v as keyof typeof CBOE_VENUES]
        if (!url) {
          results.push({ venue: v, count: 0, status: 'invalid venue' })
          continue
        }
        
        try {
          console.log(`Fetching CBOE symbols from: ${url}`)
          const response = await fetch(url, {
            headers: {
              'Accept': 'text/csv, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; TradeDataFetcher/1.0)'
            }
          })
          
          if (!response.ok) {
            console.error(`Failed to fetch ${v}: ${response.status}`)
            results.push({ venue: v, count: 0, status: `HTTP ${response.status}` })
            continue
          }
          
          const csvData = await response.text()
          const symbols = parseCboeSymbolCsv(csvData, v.toUpperCase())
          
          if (symbols.length === 0) {
            results.push({ venue: v, count: 0, status: 'no symbols found' })
            continue
          }
          
          // Upsert symbols in batches
          const batchSize = 500
          let upsertedCount = 0
          
          for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize)
            
            const { error } = await supabase
              .from('symbology')
              .upsert(batch, { 
                onConflict: 'symbol,venue,source',
                ignoreDuplicates: false 
              })
            
            if (error) {
              console.error(`Upsert error for ${v}: ${error.message}`)
            } else {
              upsertedCount += batch.length
            }
          }
          
          console.log(`Upserted ${upsertedCount} symbols for ${v}`)
          results.push({ venue: v, count: upsertedCount, status: 'success' })
          
        } catch (e) {
          console.error(`Error fetching ${v}: ${e}`)
          results.push({ venue: v, count: 0, status: `error: ${e}` })
        }
      }
    }
    
    // Log activity
    await supabase.from('activity_logs').insert({
      log_type: 'info',
      message: `Symbology fetch completed`,
      details: { source, results }
    })
    
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
