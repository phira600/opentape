import { createClient } from 'npm:@supabase/supabase-js@2'
import { 
  corsHeaders, 
  validateApiKey, 
  checkIpWhitelist, 
  getClientIp,
  getCachedResponse,
  setCachedResponse,
  errorResponse,
  jsonResponse
} from "../_shared/api-utils.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Validate API key
    const apiKey = req.headers.get("x-api-key") || "";
    const { valid, keyId } = await validateApiKey(supabase, apiKey);
    
    if (!valid) {
      return errorResponse("Invalid or missing API key", 401);
    }

    // Check IP whitelist (now cached)
    const clientIp = getClientIp(req);
    if (keyId) {
      const ipAllowed = await checkIpWhitelist(supabase, keyId, clientIp);
      if (!ipAllowed) {
        console.log(`IP ${clientIp} not allowed for API key ${keyId}`);
        return errorResponse("IP address not allowed", 403);
      }
    }

    const url = new URL(req.url)
    const params = Object.fromEntries(url.searchParams)
    
    // Also support POST body
    let body: Record<string, string> = {}
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}))
    }
    
    // Merge params from URL and body
    const query = { ...params, ...body }
    
    console.log('Symbology query:', query)
    
    // Check response cache
    const cacheKey = `symbology:${JSON.stringify(query)}`;
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Cache hit for symbology query`);
      return jsonResponse(cachedResponse, true);
    }
    
    // Build query
    let dbQuery = supabase
      .from('symbology')
      .select('id, symbol, isin, name, venue, currency, source, mic, segment, tick_table')
    
    // Filter by symbol (exact or partial match)
    if (query.symbol) {
      if (query.exact === 'true') {
        dbQuery = dbQuery.eq('symbol', query.symbol.toUpperCase())
      } else {
        dbQuery = dbQuery.ilike('symbol', `%${query.symbol}%`)
      }
    }
    
    // Filter by ISIN
    if (query.isin) {
      dbQuery = dbQuery.eq('isin', query.isin.toUpperCase())
    }
    
    // Filter by name (partial match)
    if (query.name) {
      dbQuery = dbQuery.ilike('name', `%${query.name}%`)
    }
    
    // Filter by MIC (Market Identifier Code)
    if (query.mic) {
      dbQuery = dbQuery.eq('mic', query.mic.toUpperCase())
    }
    
    // Filter by source
    if (query.source) {
      dbQuery = dbQuery.eq('source', query.source.toUpperCase())
    }
    
    // Filter by currency
    if (query.currency) {
      dbQuery = dbQuery.eq('currency', query.currency.toUpperCase())
    }
    
    // Pagination
    const limit = parseInt(query.limit || '100')
    const offset = parseInt(query.offset || '0')
    
    dbQuery = dbQuery
      .order('symbol', { ascending: true })
      .order('isin', { ascending: true })
      .range(offset, offset + limit - 1)
    
    const { data, error } = await dbQuery
    
    if (error) {
      console.error('Query error:', error)
      return errorResponse(error.message, 500);
    }
    
    // Deduplicate by creating a flat structure grouped by ISIN
    // Each ISIN appears once with all its venues/currencies as arrays
    const deduped = new Map<string, any>()
    
    for (const row of (data || [])) {
      const key = row.isin || row.symbol // Use ISIN as primary key, fallback to symbol
      
      if (!deduped.has(key)) {
        deduped.set(key, {
          isin: row.isin,
          symbol: row.symbol,
          name: row.name,
          currency: row.currency,
          source: row.source,
          mic: row.mic,
          segment: row.segment,
          tick_table: row.tick_table,
          venues: [row.venue],
        })
      } else {
        const existing = deduped.get(key)
        // Add venue if not already present
        if (!existing.venues.includes(row.venue)) {
          existing.venues.push(row.venue)
        }
        // Prefer non-null values
        if (!existing.name && row.name) existing.name = row.name
        if (!existing.currency && row.currency) existing.currency = row.currency
        if (!existing.mic && row.mic) existing.mic = row.mic
        if (!existing.segment && row.segment) existing.segment = row.segment
      }
    }
    
    const flatData = Array.from(deduped.values())
    
    const responseData = { 
      success: true, 
      data: flatData,
      count: flatData.length,
      limit,
      offset 
    };
    
    // Cache the response
    setCachedResponse(cacheKey, responseData);
    
    return jsonResponse(responseData, false);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Function error: ${errorMessage}`)
    return errorResponse(errorMessage, 500);
  }
})
