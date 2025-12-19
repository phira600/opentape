import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

// In-memory LRU cache for API key validation
const API_KEY_CACHE = new Map<string, { valid: boolean; keyId: string | null; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

async function validateApiKey(supabase: any, apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  
  const cached = API_KEY_CACHE.get(apiKey);
  if (cached && cached.expires > Date.now()) {
    if (cached.valid && cached.keyId) {
      EdgeRuntime.waitUntil(
        supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", cached.keyId)
      );
    }
    return cached.valid;
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  const { data: keyData, error } = await supabase
    .from("api_keys")
    .select("id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();
  
  const isValid = !error && !!keyData;
  
  if (API_KEY_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = API_KEY_CACHE.keys().next().value;
    if (oldestKey) API_KEY_CACHE.delete(oldestKey);
  }
  
  API_KEY_CACHE.set(apiKey, { 
    valid: isValid, 
    keyId: keyData?.id || null, 
    expires: Date.now() + CACHE_TTL_MS 
  });
  
  if (isValid && keyData?.id) {
    EdgeRuntime.waitUntil(
      supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyData.id)
    );
  }
  
  return isValid;
}

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
    const isValid = await validateApiKey(supabase, apiKey);
    
    if (!isValid) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
    
    // Filter by venue
    if (query.venue) {
      dbQuery = dbQuery.eq('venue', query.venue.toUpperCase())
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
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        data: flatData,
        count: flatData.length,
        limit,
        offset 
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
