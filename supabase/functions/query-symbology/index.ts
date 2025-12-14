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

  try {
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
      .select('*')
    
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
      .range(offset, offset + limit - 1)
    
    const { data, error, count } = await dbQuery
    
    if (error) {
      console.error('Query error:', error)
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        data,
        count: data?.length || 0,
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
